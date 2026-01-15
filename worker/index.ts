import { createClient } from '@supabase/supabase-js';
import { generateImage } from '../lib/image-generation';
import {
  WORKER_POLL_INTERVAL_MS,
  USER_COOLDOWN_SECONDS,
  TILE_LOCK_DURATION_SECONDS,
  GENERATED_IMAGE_SIZE,
} from '../lib/constants';
import { config } from 'dotenv';
import { resolve } from 'path';
import sharp from 'sharp';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

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
      console.log(`Generated URL type: ${generatedUrl.substring(0, 50)}...`);
      
      let imageBuffer: Buffer;
      
      // Check if it's a base64 data URL
      if (generatedUrl.startsWith('data:image/')) {
        // Extract base64 data from data URL
        const commaIndex = generatedUrl.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid base64 data URL format: no comma found');
        }
        const base64Data = generatedUrl.substring(commaIndex + 1);
        if (!base64Data || base64Data.length < 100) {
          console.error('Base64 data seems too short:', base64Data.length, 'chars');
          throw new Error('Invalid base64 data URL format: data too short');
        }
        console.log(`Extracting base64 data, length: ${base64Data.length} characters`);
        imageBuffer = Buffer.from(base64Data, 'base64');
        console.log(`Decoded image buffer size: ${imageBuffer.length} bytes`);
      } else {
        // It's a regular URL - download it
        const imageResponse = await fetch(generatedUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }

        const imageBlob = await imageResponse.blob();
        imageBuffer = Buffer.from(await imageBlob.arrayBuffer());
      }

      // Resize and optimize image (preserve quality, use PNG for better quality)
      console.log(`Processing image from ${imageBuffer.length} bytes...`);
      
      // Detect original format
      const metadata = await sharp(imageBuffer).metadata();
      const originalFormat = metadata.format;
      console.log(`Original image format: ${originalFormat}, dimensions: ${metadata.width}x${metadata.height}`);
      
      // Resize to GENERATED_IMAGE_SIZE x GENERATED_IMAGE_SIZE
      // Use 'cover' instead of 'contain' to fill the entire tile
      let processedBuffer = await sharp(imageBuffer)
        .resize(GENERATED_IMAGE_SIZE, GENERATED_IMAGE_SIZE, {
          fit: 'cover', // Fill the entire tile
          position: 'center',
        })
        .png({ 
          quality: 100, // Maximum quality for PNG
          compressionLevel: 6, // Balance between size and speed (0-9, 6 is good)
        })
        .toBuffer();
      
      console.log(`Processed image to ${processedBuffer.length} bytes (${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
      
      // Check if still too large (should be under 5MB for safety)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (processedBuffer.length > maxSize) {
        // Only compress if absolutely necessary - use high quality JPEG
        console.log('Image still too large, converting to high-quality JPEG...');
        processedBuffer = await sharp(imageBuffer)
          .resize(GENERATED_IMAGE_SIZE, GENERATED_IMAGE_SIZE, {
            fit: 'cover',
            position: 'center',
          })
          .jpeg({ 
            quality: 92, // High quality (was 70, now 92)
            mozjpeg: true,
            progressive: true,
          })
          .toBuffer();
        console.log(`Compressed to JPEG: ${processedBuffer.length} bytes (${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
      }

      // Determine file extension based on final format
      const useJpeg = processedBuffer.length > maxSize || processedBuffer.length < imageBuffer.length * 0.5;
      const fileExtension = useJpeg ? 'jpg' : 'png';
      const contentType = useJpeg ? 'image/jpeg' : 'image/png';
      
      // Upload to Supabase Storage
      const fileName = `${job.x}_${job.y}_${Date.now()}.${fileExtension}`;
      console.log(`Uploading image as ${fileExtension} (${contentType})...`);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tile-images')
        .upload(fileName, processedBuffer, {
          contentType: contentType,
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      if (!uploadData) {
        throw new Error('Upload succeeded but no data returned');
      }

      console.log(`✅ Image uploaded successfully: ${fileName}`);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('tile-images')
        .getPublicUrl(fileName);

      if (!urlData || !urlData.publicUrl) {
        throw new Error('Failed to get public URL for uploaded image');
      }

      imageUrl = urlData.publicUrl;
      console.log(`✅ Public URL generated: ${imageUrl}`);
      
      // Verify the URL is accessible
      try {
        const verifyResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (!verifyResponse.ok) {
          console.warn(`⚠️ Image URL verification failed: ${verifyResponse.status} ${verifyResponse.statusText}`);
        } else {
          console.log(`✅ Image URL verified - accessible at ${imageUrl}`);
        }
      } catch (verifyError) {
        console.warn('⚠️ Could not verify image URL (non-critical):', verifyError);
      }
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

      // Update tile with better error handling
      const { error: tileError, data: tileData } = await supabase
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
        })
        .select();

      if (tileError) {
        console.error(`Failed to update canvas_tiles for (${job.x}, ${job.y}):`, tileError);
      } else {
        console.log(`✅ Updated canvas_tiles for (${job.x}, ${job.y}) with image:`, imageUrl);
      }

      // Insert history
      const { error: historyError } = await supabase.from('tile_history').insert({
        x: job.x,
        y: job.y,
        image_url: imageUrl,
        prompt: job.prompt,
        user_id: job.user_id,
      });

      if (historyError) {
        console.error(`Failed to insert tile_history for (${job.x}, ${job.y}):`, historyError);
      }

      // Mark job succeeded
      const { error: jobUpdateError } = await supabase
        .from('generation_jobs')
        .update({
          status: 'succeeded',
          result_image_url: imageUrl,
        })
        .eq('id', jobId);

      if (jobUpdateError) {
        console.error(`Failed to update generation_jobs for job ${jobId}:`, jobUpdateError);
      } else {
        console.log(`✅ Updated generation_jobs for job ${jobId} with result_image_url:`, imageUrl);
      }

      // Set cooldown (skip if user_id is null since auth is not required)
      if (job.user_id) {
        await supabase
          .from('user_cooldowns')
          .upsert({
            user_id: job.user_id,
            cooldown_until: new Date(
              Date.now() + USER_COOLDOWN_SECONDS * 1000
            ).toISOString(),
          });
      }
    } else {
      // RPC succeeded
      console.log(`✅ RPC complete_tile_generation succeeded for job ${jobId}`);
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
    .select('id, status, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error polling jobs:', error);
    return;
  }

  if (jobs && jobs.length > 0) {
    console.log(`Found ${jobs.length} queued job(s), processing...`);
    await processJob(jobs[0].id);
  } else {
    // Also check for stuck "running" jobs older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckJobs } = await supabase
      .from('generation_jobs')
      .select('id, status, created_at')
      .eq('status', 'running')
      .lt('created_at', fiveMinutesAgo)
      .limit(1);
    
    if (stuckJobs && stuckJobs.length > 0) {
      console.log(`Found ${stuckJobs.length} stuck running job(s), resetting to queued...`);
      await supabase
        .from('generation_jobs')
        .update({ status: 'queued' })
        .eq('id', stuckJobs[0].id);
    }
  }
}

// Start polling
console.log('Worker started. Polling interval:', WORKER_POLL_INTERVAL_MS, 'ms');
setInterval(pollJobs, WORKER_POLL_INTERVAL_MS);
pollJobs(); // Run immediately
