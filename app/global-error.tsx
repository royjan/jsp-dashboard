'use client'

/**
 * Last-resort boundary: catches throws in the ROOT layout, which app/error.tsx
 * cannot — by the time that would render, the layout it lives inside has
 * already failed.
 *
 * Because it REPLACES the root layout, it must ship its own <html>/<body>, and
 * it cannot rely on anything the layout provides: no Providers, no theme class,
 * no Tailwind tokens (globals.css is imported by the layout that just died).
 * So the styles here are inline and deliberately self-sufficient, and the
 * colours are the same literals the layout advertises in its themeColor meta.
 */

import * as React from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[global-error]', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#0f1217',
          color: '#e9e7e3',
          fontFamily: 'system-ui, -apple-system, "Arial Hebrew", sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <div style={{ fontSize: '30px', lineHeight: 1 }}>⚠︎</div>
          <h1 style={{ margin: '14px 0 6px', fontSize: '20px', fontWeight: 700 }}>
            האפליקציה נפלה
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#9ba1a8', lineHeight: 1.6 }}>
            זו תקלה ברמת האפליקציה, לא במסך מסוים. טעינה מחדש היא הדבר הראשון לנסות.
          </p>

          <button
            onClick={reset}
            style={{
              marginTop: '18px',
              font: 'inherit',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              border: '1px solid #4d3a18',
              background: '#2b2110',
              color: '#f0a02c',
              borderRadius: '9px',
              padding: '8px 20px',
            }}
          >
            טען מחדש
          </button>

          {error.digest && (
            <p
              dir="ltr"
              style={{
                marginTop: '16px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                color: '#767c84',
              }}
            >
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
