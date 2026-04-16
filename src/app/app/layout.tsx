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
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter:wght@200;300;400;500;600&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { scroll-behavior: smooth; }
          body {
            background: #000;
            color: #f0f0f0;
            font-family: 'Inter', -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
          }
          * { cursor: none !important; }
          a { color: inherit; text-decoration: none; }
          button { font-family: inherit; }

          .nav-root {
            position: sticky; top: 0; z-index: 200;
            background: rgba(0,0,0,0.92);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-bottom: 1px solid #111;
          }
          .nav-inner {
            max-width: 1200px; margin: 0 auto;
            padding: 0 24px;
            display: flex; align-items: center;
            height: 48px;
          }
          .nav-logo {
            font-family: 'DM Mono', monospace;
            font-size: 11px; font-weight: 500;
            letter-spacing: 0.16em; color: #fff;
            flex-shrink: 0; padding-right: 20px;
            border-right: 1px solid #111;
          }
          .nav-primary { display: flex; align-items: center; border-right: 1px solid #111; }
          .nav-link {
            font-family: 'DM Mono', monospace;
            font-size: 10px; color: #444;
            padding: 0 16px; height: 48px;
            display: flex; align-items: center;
            white-space: nowrap; transition: color 0.15s;
            border-right: 1px solid #111;
            letter-spacing: 0.08em; text-transform: uppercase;
          }
          .nav-link:hover { color: #fff; }
          .nav-more { position: relative; flex-shrink: 0; }
          .nav-more-btn {
            font-family: 'DM Mono', monospace;
            font-size: 10px; color: #333;
            background: none; border: none;
            padding: 0 16px; height: 48px;
            display: flex; align-items: center; gap: 5px;
            letter-spacing: 0.08em; text-transform: uppercase;
            transition: color 0.15s; border-right: 1px solid #111;
          }
          .nav-more-btn::after { content: '▾'; font-size: 9px; }
          .nav-more-btn:hover { color: #fff; }
          .nav-dropdown {
            display: none; position: absolute; right: 0; top: 100%;
            background: #000; border: 1px solid #111; border-top: none;
            min-width: 160px; z-index: 300;
          }
          .nav-more:hover .nav-dropdown { display: block; }
          .nav-dropdown a {
            display: block; padding: 10px 16px;
            font-family: 'DM Mono', monospace; font-size: 10px; color: #444;
            border-bottom: 1px solid #0a0a0a;
            transition: color 0.15s, background 0.15s;
            letter-spacing: 0.08em; text-transform: uppercase;
          }
          .nav-dropdown a:last-child { border-bottom: none; }
          .nav-dropdown a:hover { color: #fff; background: #0a0a0a; }
          .nav-season {
            font-family: 'DM Mono', monospace; font-size: 10px; color: #222;
            letter-spacing: 0.1em; margin-left: auto; padding-left: 16px; flex-shrink: 0;
          }
          main { min-height: calc(100vh - 48px); }

          [style*="color: '#333'"],[style*="color:'#333'"],
          [style*="color: '#444'"],[style*="color:'#444'"] { color: #666 !important; }
          [style*="color: '#555'"],[style*="color:'#555'"] { color: #888 !important; }
          [style*="color: '#2a2a2a'"],[style*="color:'#2a2a2a'"],
          [style*="color: '#1a1a1a'"],[style*="color:'#1a1a1a'"] { color: #555 !important; }
        `}</style>
      </head>
      <body>
        <nav className="nav-root">
          <div className="nav-inner">
            <Link href="/" className="nav-logo">SWINGFACTR</Link>
            <div className="nav-primary">
              <Link href="/props"    className="nav-link">Props</Link>
              <Link href="/insights" className="nav-link">Insights</Link>
              <Link href="/playoffs" className="nav-link">Playoffs</Link>
              <Link href="/profiles" className="nav-link">Profiles</Link>
              <Link href="/compare"  className="nav-link">Compare</Link>
              <Link href="/matchup"  className="nav-link">Matchup</Link>
            </div>
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
