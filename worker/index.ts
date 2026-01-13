import { createClient } from '@supabase/supabase-js';
import { generateImage } from '../lib/image-generation';
import {
  WORKER_POLL_INTERVAL_MS,
  USER_COOLDOWN_SECONDS,
  TILE_LOCK_DURATION_SECONDS,
} from '../lib/constants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function processJob(jobId: string) {
  console.log(`Processing job ${jobId}`);

  try {
    // Mark job as running
    const { error: updateError } = await supabase
      .from('generation_jobs')
      .update({ status: 'running' })
      .eq('id', jobId)
      .eq('status', 'queued');

    if (updateError) {
      console.error(`Failed to mark job ${jobId} as running:`, updateError);
      return;
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`Failed to fetch job ${jobId}:`, jobError);
      return;
    }

    // Generate image
    console.log(`Generating image for job ${jobId} with prompt: "${job.prompt}"`);
    let imageUrl: string;

    try {
      const generatedUrl = await generateImage(job.prompt);
      
      // Download the image
      const imageResponse = await fetch(generatedUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.statusText}`);
      }

      const imageBlob = await imageResponse.blob();
      const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());

      // Upload to Supabase Storage
      const fileName = `${job.x}_${job.y}_${Date.now()}.png`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tile-images')
        .upload(fileName, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('tile-images')
        .getPublicUrl(fileName);

      imageUrl = urlData.publicUrl;
    } catch (error) {
      console.error(`Image generation failed for job ${jobId}:`, error);
      
      // Mark job as failed and clear lock
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', jobId);

      await supabase
        .from('canvas_tiles')
        .update({
          lock_until: null,
          lock_by: null,
        })
        .eq('x', job.x)
        .eq('y', job.y);

      return;
    }

    // Transaction: update tile, insert history, mark job succeeded, set cooldown, clear lock
    const { error: transactionError } = await supabase.rpc('complete_tile_generation', {
      p_job_id: jobId,
      p_x: job.x,
      p_y: job.y,
      p_image_url: imageUrl,
      p_prompt: job.prompt,
      p_user_id: job.user_id,
      p_cooldown_seconds: USER_COOLDOWN_SECONDS,
    });

    if (transactionError) {
      // If RPC doesn't exist, do it manually
      console.log('RPC not found, executing manually...');

      // Update tile
      await supabase
        .from('canvas_tiles')
        .upsert({
          x: job.x,
          y: job.y,
          current_image_url: imageUrl,
          current_prompt: job.prompt,
          updated_by: job.user_id,
          updated_at: new Date().toISOString(),
          lock_until: null,
          lock_by: null,
          version: 1,
        });

      // Insert history
      await supabase.from('tile_history').insert({
        x: job.x,
        y: job.y,
        image_url: imageUrl,
        prompt: job.prompt,
        user_id: job.user_id,
      });

      // Mark job succeeded
      await supabase
        .from('generation_jobs')
        .update({
          status: 'succeeded',
          result_image_url: imageUrl,
        })
        .eq('id', jobId);

      // Set cooldown
      await supabase
        .from('user_cooldowns')
        .upsert({
          user_id: job.user_id,
          cooldown_until: new Date(
            Date.now() + USER_COOLDOWN_SECONDS * 1000
          ).toISOString(),
        });
    }

    console.log(`Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`Unexpected error processing job ${jobId}:`, error);
    
    // Mark job as failed
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unexpected error',
      })
      .eq('id', jobId);

    // Clear lock
    const { data: job } = await supabase
      .from('generation_jobs')
      .select('x, y')
      .eq('id', jobId)
      .single();

    if (job) {
      await supabase
        .from('canvas_tiles')
        .update({
          lock_until: null,
          lock_by: null,
        })
        .eq('x', job.x)
        .eq('y', job.y);
    }
  }
}

async function pollJobs() {
  console.log('Polling for queued jobs...');

  const { data: jobs, error } = await supabase
    .from('generation_jobs')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error polling jobs:', error);
    return;
  }

  if (jobs && jobs.length > 0) {
    await processJob(jobs[0].id);
  }
}

// Start polling
console.log('Worker started. Polling interval:', WORKER_POLL_INTERVAL_MS, 'ms');
setInterval(pollJobs, WORKER_POLL_INTERVAL_MS);
pollJobs(); // Run immediately
