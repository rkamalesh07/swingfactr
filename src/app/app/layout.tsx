import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'SwingFactr — NBA Intelligence',
  description: 'Daily NBA analytics. Streaks, breakouts, matchups, playoff odds.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --bg: #0c0c0e;
            --bg-1: #141418;
            --bg-2: #1a1a20;
            --text: #f2f0eb;
            --text-2: #8c8a85;
            --text-3: #44434f;
            --accent: #c8f135;
            --accent-dim: #8ab020;
            --border: #222228;
            --border-2: #2e2e36;
            --red: #f05252;
            --blue: #5b8ef0;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
          }
          .mono { font-family: 'DM Mono', monospace; }
          a { color: inherit; text-decoration: none; }

          /* Nav */
          .nav-wrap {
            position: sticky; top: 0; z-index: 100;
            border-bottom: 1px solid var(--border);
            background: rgba(12,12,14,0.95);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
          }
          .nav-inner {
            max-width: 1400px; margin: 0 auto;
            padding: 0 28px;
            height: 52px;
            display: flex; align-items: center; gap: 0;
          }
          .nav-logo {
            font-family: 'DM Mono', monospace;
            font-size: 13px; font-weight: 500;
            letter-spacing: 0.12em;
            color: var(--accent);
            margin-right: 32px;
            flex-shrink: 0;
          }
          .nav-links {
            display: flex; align-items: center;
            overflow-x: auto; flex: 1;
            scrollbar-width: none;
            gap: 0;
          }
          .nav-links::-webkit-scrollbar { display: none; }
          .nav-link {
            font-size: 12px; font-weight: 400;
            color: #b0aea8;
            padding: 0 14px; height: 52px;
            display: flex; align-items: center;
            white-space: nowrap;
            transition: color 0.15s;
            border-right: 1px solid var(--border);
            letter-spacing: 0.02em;
          }
          .nav-link:first-child { border-left: 1px solid var(--border); }
          .nav-link:hover { color: #f2f0eb; }
          .nav-link.active { color: var(--accent); }
          .nav-season {
            font-family: 'DM Mono', monospace;
            font-size: 11px; color: var(--text-3);
            margin-left: 20px; flex-shrink: 0;
            letter-spacing: 0.08em;
          }

          /* Main content */
          main { min-height: calc(100vh - 52px); }
        `}</style>
      </head>
      <body>
        <div className="nav-wrap">
          <div className="nav-inner">
            <Link href="/" className="nav-logo">SWINGFACTR</Link>
            <div className="nav-links">
              <Link href="/live"      className="nav-link">Live</Link>
              <Link href="/games"     className="nav-link">Games</Link>
              <Link href="/playoffs"  className="nav-link">Playoffs</Link>
              <Link href="/props"     className="nav-link">Props</Link>
              <Link href="/profiles"  className="nav-link">Profiles</Link>
              <Link href="/insights"  className="nav-link">Insights</Link>
              <Link href="/compare"   className="nav-link">Head-to-Head</Link>
              <Link href="/matchup"   className="nav-link">Matchups</Link>
              <Link href="/lineups"   className="nav-link">Lineups</Link>
              <Link href="/clutch"    className="nav-link">Clutch</Link>
              <Link href="/fatigue"   className="nav-link">Fatigue</Link>
              <Link href="/players"   className="nav-link">Players</Link>
              <Link href="/teams"     className="nav-link">Teams</Link>
              <Link href="/rapm"      className="nav-link">RAPM</Link>
              <Link href="/about"     className="nav-link">About</Link>
            </div>
            <span className="nav-season mono">2025–26</span>
          </div>
        </div>
        <main>{children}</main>
      </body>
    </html>
  )
}
