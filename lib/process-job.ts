import { SupabaseClient } from '@supabase/supabase-js';
import { generateImage } from './image-generation';
import { USER_COOLDOWN_SECONDS, GENERATED_IMAGE_SIZE } from './constants';
import sharp from 'sharp';

export async function processNextJob(supabase: SupabaseClient): Promise<boolean> {
  const { data: jobs, error } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error || !jobs || jobs.length === 0) return false;

  const jobId = jobs[0].id;

  try {
    const { error: updateError } = await supabase
      .from('generation_jobs')
      .update({ status: 'running' })
      .eq('id', jobId)
      .eq('status', 'queued');

    if (updateError) return false;

    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) return false;

    let imageUrl: string;

    try {
      const generatedUrl = await generateImage(job.prompt);
      let imageBuffer: Buffer;

      if (generatedUrl.startsWith('data:image/')) {
        const commaIndex = generatedUrl.indexOf(',');
        if (commaIndex === -1) throw new Error('Invalid base64 data URL');
        imageBuffer = Buffer.from(generatedUrl.substring(commaIndex + 1), 'base64');
      } else {
        const imageResponse = await fetch(generatedUrl);
        if (!imageResponse.ok) throw new Error(`Failed to download: ${imageResponse.statusText}`);
        imageBuffer = Buffer.from(await (await imageResponse.blob()).arrayBuffer());
      }

      const maxSize = 5 * 1024 * 1024;
      let processedBuffer = await sharp(imageBuffer)
        .resize(GENERATED_IMAGE_SIZE, GENERATED_IMAGE_SIZE, { fit: 'cover', position: 'center' })
        .png({ quality: 100, compressionLevel: 6 })
        .toBuffer();

      const useJpeg = processedBuffer.length > maxSize;
      const fileExtension = useJpeg ? 'jpg' : 'png';
      const contentType = useJpeg ? 'image/jpeg' : 'image/png';

      if (processedBuffer.length > maxSize) {
        processedBuffer = await sharp(imageBuffer)
          .resize(GENERATED_IMAGE_SIZE, GENERATED_IMAGE_SIZE, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 92, mozjpeg: true, progressive: true })
          .toBuffer();
      }

      const fileName = `${job.x}_${job.y}_${Date.now()}.${fileExtension}`;
      const { error: uploadError } = await supabase.storage
        .from('tile-images')
        .upload(fileName, processedBuffer, { contentType, upsert: false });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage.from('tile-images').getPublicUrl(fileName);
      if (!urlData?.publicUrl) throw new Error('Failed to get public URL');
      imageUrl = urlData.publicUrl;
    } catch (err) {
      await supabase
        .from('generation_jobs')
        .update({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' })
        .eq('id', jobId);
      await supabase
        .from('canvas_tiles')
        .update({ lock_until: null, lock_by: null })
        .eq('x', job.x)
        .eq('y', job.y);
      return true;
    }

    const { error: rpcError } = await supabase.rpc('complete_tile_generation', {
      p_job_id: jobId,
      p_x: job.x,
      p_y: job.y,
      p_image_url: imageUrl,
      p_prompt: job.prompt,
      p_user_id: job.user_id,
      p_cooldown_seconds: USER_COOLDOWN_SECONDS,
    });

    if (rpcError) {
      await supabase.from('canvas_tiles').upsert({
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
      await supabase.from('tile_history').insert({
        x: job.x,
        y: job.y,
        image_url: imageUrl,
        prompt: job.prompt,
        user_id: job.user_id,
      });
      await supabase
        .from('generation_jobs')
        .update({ status: 'succeeded', result_image_url: imageUrl })
        .eq('id', jobId);
      if (job.user_id) {
        await supabase.from('user_cooldowns').upsert({
          user_id: job.user_id,
          cooldown_until: new Date(Date.now() + USER_COOLDOWN_SECONDS * 1000).toISOString(),
        });
      }
    }

    return true;
  } catch (err) {
    console.error('processNextJob error:', err);
    return false;
  }
}
