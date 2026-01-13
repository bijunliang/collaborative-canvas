import { GENERATED_IMAGE_SIZE } from './constants';

const COMETAPI_BASE_URL = 'https://api.cometapi.com';
const MODEL = 'gemini-2.5-flash-image';

export async function generateImage(prompt: string): Promise<string> {
  const apiKey = process.env.COMETAPI_KEY;
  if (!apiKey) {
    throw new Error('COMETAPI_KEY is not set');
  }

  // CometAPI uses OpenAI-compatible format
  const response = await fetch(`${COMETAPI_BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      n: 1,
      size: `${GENERATED_IMAGE_SIZE}x${GENERATED_IMAGE_SIZE}`,
      response_format: 'url', // or 'b64_json' if we want base64
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CometAPI error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  // CometAPI returns OpenAI-compatible format: { data: [{ url: string }] }
  if (data.data && data.data[0] && data.data[0].url) {
    return data.data[0].url;
  }

  // Fallback: check for base64 if URL format not available
  if (data.data && data.data[0] && data.data[0].b64_json) {
    // Return base64 data URL
    return `data:image/png;base64,${data.data[0].b64_json}`;
  }

  throw new Error('Unexpected response format from CometAPI');
}
