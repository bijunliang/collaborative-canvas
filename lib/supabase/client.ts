import { createBrowserClient } from '@supabase/ssr';

export function createClientSupabase() {
  // In Next.js, environment variables are available at build time
  // For client-side, they must be prefixed with NEXT_PUBLIC_
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Debug: Log what we're getting (but don't log the full key)
  if (typeof window !== 'undefined') {
    console.log('🔍 Client-side env check:', {
      hasUrl: !!supabaseUrl,
      urlPreview: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'missing',
      hasKey: !!supabaseAnonKey,
      keyPreview: supabaseAnonKey ? supabaseAnonKey.substring(0, 10) + '...' : 'missing',
    });
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    const errorMsg = '❌ Missing Supabase environment variables!';
    console.error(errorMsg);
    console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
    console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✅ Set' : '❌ Missing');
    console.error('Please check your .env.local file and restart the dev server');
    // Don't throw - return a client that will fail gracefully
    // This allows the app to load and show errors
    return createBrowserClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key'
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
