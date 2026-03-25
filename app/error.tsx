'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ marginBottom: 16, fontSize: 18 }}>Something went wrong</h2>
      <button
        onClick={() => reset()}
        style={{
          padding: '8px 16px',
          background: '#333',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        Try again
      </button>
    </div>
  );
}
