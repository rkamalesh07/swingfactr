import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'SwingFactr — NBA Analytics',
  description: 'NBA lineup impact, win probability, and fatigue analytics.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          .nav-link { color: #555; font-size: 13px; text-decoration: none; padding: 0 16px; height: 48px; display: flex; align-items: center; border-right: 1px solid #1a1a1a; transition: color 0.15s; font-family: 'IBM Plex Sans', sans-serif; }
          .nav-link:hover { color: #f0f0f0; }
          .module-card { background: #0a0a0a; padding: 28px 32px; height: 100%; transition: background 0.15s; cursor: pointer; display: block; text-decoration: none; }
          .module-card:hover { background: #111; }
          .row-link { display: grid; padding: 14px 20px; border-bottom: 1px solid #111; align-items: center; cursor: pointer; transition: background 0.1s; text-decoration: none; color: inherit; }
          .row-link:hover { background: #111; }
          .row-link:last-child { border-bottom: none; }
        `}</style>
      </head>
      <body style={{ background: '#0a0a0a', color: '#f0f0f0', minHeight: '100vh', margin: 0 }}>
        <nav style={{
          borderBottom: '1px solid #1a1a1a',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          height: '48px',
        }}>
          <Link href="/" style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 600,
            fontSize: '13px',
            color: '#f0f0f0',
            letterSpacing: '0.08em',
            textDecoration: 'none',
            marginRight: '40px',
          }}>
            SWINGFACTR
          </Link>
          <Link href="/live" className="nav-link">Live</Link>
          <Link href="/games" className="nav-link">Games</Link>
          <Link href="/lineups" className="nav-link">Lineups</Link>
          <Link href="/clutch" className="nav-link">Clutch</Link>
          <Link href="/fatigue" className="nav-link">Fatigue</Link>
          <Link href="/players" className="nav-link">Players</Link>
          <Link href="/teams" className="nav-link">Teams</Link>
          <Link href="/rapm" className="nav-link">RAPM</Link>
          <div style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a' }}>
            2024–25
          </div>
        </nav>
        <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
