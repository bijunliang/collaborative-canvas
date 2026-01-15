/**
 * Converts an image URL to a valid public URL from Supabase Storage.
 * If the URL is already a full URL, it returns it as-is.
 * If it's a file path, it converts it to a public URL.
 * 
 * This function works both on client and server side.
 */
export function getImagePublicUrl(
  imageUrl: string | null | undefined,
  supabaseUrl?: string
): string | null {
  if (!imageUrl) {
    return null;
  }

  // If it's already a full URL (http:// or https://), return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // If it's a data URL (base64), return as-is
  if (imageUrl.startsWith('data:image/')) {
    return imageUrl;
  }

  // Otherwise, it's likely a file path - convert to public URL
  // Remove leading slash if present
  const filePath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
  
  // If we have a Supabase URL, construct the public URL directly
  // Format: https://[project].supabase.co/storage/v1/object/public/tile-images/[filepath]
  if (supabaseUrl) {
    // Extract the base URL (remove /rest/v1 if present)
    const baseUrl = supabaseUrl.replace(/\/rest\/v1.*$/, '');
    return `${baseUrl}/storage/v1/object/public/tile-images/${filePath}`;
  }

  // Fallback: try to use Supabase client (client-side only)
  if (typeof window !== 'undefined') {
    try {
      const { createClientSupabase } = require('./supabase/client');
      const supabase = createClientSupabase();
      const { data } = supabase.storage
        .from('tile-images')
        .getPublicUrl(filePath);
      return data.publicUrl;
    } catch (e) {
      console.warn('Failed to get public URL from Supabase client:', e);
    }
  }

  // Last resort: return the original URL (might work if it's already correct)
  return imageUrl;
}
