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
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --bg: #0c0c0e;
            --bg-1: #141418;
            --bg-2: #1a1a20;
            --text: #f2f0eb;
            --text-2: #b0aea8;
            --text-3: #787672;
            --text-dim: #55534f;
            --accent: #c8f135;
            --border: #222228;
            --border-2: #2e2e36;
            --red: #f87171;
            --green: #4ade80;
            --blue: #5b8ef0;
            --orange: #f97316;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { scroll-behavior: smooth; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            cursor: crosshair;
          }
          a { color: inherit; text-decoration: none; }
          button { cursor: pointer; font-family: inherit; }

          /* ── Nav ───────────────────────────────────────────────────────── */
          .nav-root {
            position: sticky; top: 0; z-index: 200;
            background: rgba(12,12,14,0.92);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border);
          }
          .nav-inner {
            max-width: 1200px; margin: 0 auto;
            padding: 0 24px;
            display: flex; align-items: center;
            height: 48px; gap: 0;
          }
          .nav-logo {
            font-family: 'DM Mono', monospace;
            font-size: 12px; font-weight: 500;
            letter-spacing: 0.14em;
            color: var(--accent);
            margin-right: 0;
            flex-shrink: 0;
            padding-right: 20px;
            border-right: 1px solid var(--border);
          }

          /* Primary nav — most important pages */
          .nav-primary {
            display: flex; align-items: center;
            border-right: 1px solid var(--border);
          }
          .nav-link {
            font-family: 'Inter', sans-serif;
            font-size: 12px; font-weight: 400;
            color: var(--text-2);
            padding: 0 14px; height: 48px;
            display: flex; align-items: center;
            white-space: nowrap;
            transition: color 0.15s;
            border-right: 1px solid var(--border);
            letter-spacing: 0.01em;
          }
          .nav-link:first-child { border-left: none; }
          .nav-link:hover { color: var(--text); }
          .nav-link.accent { color: var(--accent); }
          .nav-link.accent:hover { color: var(--accent); opacity: 0.8; }

          /* Secondary nav — overflow into dropdown */
          .nav-more {
            position: relative;
            margin-left: auto;
            flex-shrink: 0;
          }
          .nav-more-btn {
            font-family: 'DM Mono', monospace;
            font-size: 11px; color: var(--text-3);
            background: none; border: none;
            padding: 0 16px; height: 48px;
            display: flex; align-items: center; gap: 6px;
            letter-spacing: 0.08em;
            transition: color 0.15s;
          }
          .nav-more-btn:hover { color: var(--text-2); }
          .nav-more-btn::after {
            content: '▾'; font-size: 10px;
          }
          .nav-dropdown {
            display: none;
            position: absolute; right: 0; top: 100%;
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-top: none;
            min-width: 160px;
            z-index: 300;
          }
          .nav-more:hover .nav-dropdown { display: block; }
          .nav-dropdown a {
            display: block;
            padding: 10px 16px;
            font-family: 'Inter', sans-serif;
            font-size: 12px; color: var(--text-2);
            border-bottom: 1px solid var(--border);
            transition: color 0.15s, background 0.15s;
          }
          .nav-dropdown a:last-child { border-bottom: none; }
          .nav-dropdown a:hover { color: var(--text); background: var(--bg-2); }

          .nav-season {
            font-family: 'DM Mono', monospace;
            font-size: 10px; color: var(--text-dim);
            letter-spacing: 0.1em;
            padding-left: 16px;
            flex-shrink: 0;
          }

          /* ── Global page styles ─────────────────────────────────────────── */
          main { min-height: calc(100vh - 48px); }

          /* Text contrast fixes */
          [style*="color: '#2a2a2a'"], [style*="color:'#2a2a2a'"],
          [style*="color: '#1a1a1a'"], [style*="color:'#1a1a1a'"],
          [style*="color: '#0d0d0d'"], [style*="color:'#0d0d0d'"],
          [style*="color: '#111'"],    [style*="color:'#111'"],
          [style*="color: '#222'"],    [style*="color:'#222'"] { color: #787672 !important; }
          [style*="color: '#333'"],    [style*="color:'#333'"],
          [style*="color: '#444'"],    [style*="color:'#444'"] { color: #909090 !important; }
          [style*="color: '#555'"],    [style*="color:'#555'"] { color: #b0aea8 !important; }
        `}</style>
      </head>
      <body>
        <nav className="nav-root">
          <div className="nav-inner">
            <Link href="/" className="nav-logo">SWINGFACTR</Link>

            {/* Primary — 6 most used */}
            <div className="nav-primary">
              <Link href="/props"    className="nav-link">Props</Link>
              <Link href="/insights" className="nav-link">Insights</Link>
              <Link href="/playoffs" className="nav-link">Playoffs</Link>
              <Link href="/profiles" className="nav-link">Profiles</Link>
              <Link href="/compare"  className="nav-link">Compare</Link>
              <Link href="/matchup"  className="nav-link">Matchup</Link>
            </div>

            {/* More dropdown */}
            <div className="nav-more">
              <button className="nav-more-btn">More</button>
              <div className="nav-dropdown">
                <Link href="/live">Live</Link>
                <Link href="/games">Games</Link>
                <Link href="/lineups">Lineups</Link>
                <Link href="/clutch">Clutch</Link>
                <Link href="/fatigue">Fatigue</Link>
                <Link href="/players">Players</Link>
                <Link href="/teams">Teams</Link>
                <Link href="/rapm">RAPM</Link>
                <Link href="/about">About</Link>
              </div>
            </div>

            <span className="nav-season">2025–26</span>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
