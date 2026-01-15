import { GENERATED_IMAGE_SIZE } from './constants';

const COMETAPI_BASE_URL = 'https://api.cometapi.com';
const MODEL = 'gemini-2.5-flash-image';

export async function generateImage(prompt: string): Promise<string> {
  const apiKey = process.env.COMETAPI_KEY;
  if (!apiKey) {
    throw new Error('COMETAPI_KEY is not set');
  }

  // gemini-2.5-flash-image uses chat completions endpoint, not images/generations
  // It returns images in the response content
  const response = await fetch(`${COMETAPI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_modalities: ['IMAGE'],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CometAPI error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  // Log the full response for debugging
  console.log('CometAPI response structure:', JSON.stringify(data, null, 2).substring(0, 1000));
  
  // gemini-2.5-flash-image returns images in chat completions format
  // Response structure: { choices: [{ message: { images: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }] } }] }
  if (data.choices && data.choices[0] && data.choices[0].message) {
    const message = data.choices[0].message;
    
    // Check for images array first (this is the correct format for gemini-2.5-flash-image)
    if (Array.isArray(message.images)) {
      for (const image of message.images) {
        if (image.type === 'image_url' && image.image_url?.url) {
          // Return the data URL directly
          return image.image_url.url;
        }
      }
    }
    
    // Fallback: Check content array (for other formats)
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'image' || part.type === 'image_url') {
          if (part.image_url?.url) {
            return part.image_url.url;
          }
          if (part.url) {
            return part.url;
          }
          if (part.image) {
            // Base64 image data
            const base64 = typeof part.image === 'string' ? part.image : part.image.data;
            return `data:image/png;base64,${base64}`;
          }
        }
        if (part.image_url) {
          return part.image_url.url || part.image_url;
        }
      }
    }
    
    // Check if content is a string - might contain markdown with embedded image
    if (typeof message.content === 'string') {
      // Find data:image/ in the content
      const dataUrlStartIndex = message.content.indexOf('data:image/');
      if (dataUrlStartIndex !== -1) {
        // Find the opening paren before the data URL (for markdown format ![image](...))
        const openingParenIndex = message.content.lastIndexOf('(', dataUrlStartIndex);
        // Find the closing paren after the data URL
        const closingParenIndex = message.content.indexOf(')', dataUrlStartIndex);
        
        if (openingParenIndex !== -1 && closingParenIndex !== -1 && closingParenIndex > dataUrlStartIndex) {
          // Extract everything between the parens
          const dataUrl = message.content.substring(openingParenIndex + 1, closingParenIndex);
          if (dataUrl.startsWith('data:image/')) {
            return dataUrl;
          }
        } else if (closingParenIndex !== -1) {
          // No opening paren found, but we have a closing one - extract from data:image/ to the closing paren
          const dataUrl = message.content.substring(dataUrlStartIndex, closingParenIndex);
          if (dataUrl.startsWith('data:image/')) {
            return dataUrl;
          }
        } else {
          // No closing paren found - the data URL might extend to the end of the string
          // This shouldn't happen, but handle it
          const dataUrl = message.content.substring(dataUrlStartIndex);
          if (dataUrl.startsWith('data:image/')) {
            return dataUrl;
          }
        }
      }
      
      // Check if it's a direct data URL
      if (message.content.startsWith('data:image/')) {
        return message.content;
      }
      
      // Check if it's a regular URL
      if (message.content.startsWith('http')) {
        return message.content;
      }
      
      // Check if the entire string is base64 (unlikely but possible)
      if (message.content.length > 100 && !message.content.includes(' ')) {
        return `data:image/png;base64,${message.content}`;
      }
    }
  }

  // Fallback: try images/generations endpoint format (for other models)
  if (data.data && data.data[0]) {
    if (data.data[0].url) {
      return data.data[0].url;
    }
    if (data.data[0].b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    }
  }

  console.error('Unexpected CometAPI response format:', JSON.stringify(data, null, 2));
  throw new Error('Unexpected response format from CometAPI. Check console for full response.');
}
