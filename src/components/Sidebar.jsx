import { NavLink, Link } from 'react-router';
import { Show, useAuth, useUser, UserButton } from '@clerk/react';
import { useAppRole, canManageReports } from '../auth/roles';
import { ROUTE_ENABLED } from '../route-flags';
import styles from './Sidebar.module.css';

const ROLE_LABELS = { user: 'Community member', authority: 'Road Enforcer', admin: 'Admin' };

// Simple SVG icons for navigation
const Icons = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  Feed: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Map: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  Tickets: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  AI: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
      <path d="M9 13v2" />
      <path d="M15 13v2" />
    </svg>
  ),
};

export default function Sidebar({ isOpen, onClose }) {
  const { isLoaded, role } = useAppRole();
  useAuth();
  const { user } = useUser();
  const canViewTickets = isLoaded && canManageReports(role);
  const displayName = (user?.firstName + " " + user?.lastName) || user?.username || 'User';
  const roleLabel = isLoaded && role ? ROLE_LABELS[role] || 'Community member' : 'Community member';

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && <div className={styles.overlay} onClick={onClose} />}
      
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        {/* Desktop Header / Mobile Hidden */}
        <div className={styles.header}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span className={styles.logoText}>RoadMap</span>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navSection}>
            <NavLink 
              to="/dashboard" 
              className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <Icons.Dashboard />
              <span>Dashboard</span>
            </NavLink>
            
            <NavLink 
              to="/feed" 
              className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <Icons.Feed />
              <span>Community reports</span>
            </NavLink>
            
            <NavLink 
              to="/map" 
              className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <Icons.Map />
              <span>2D incident map</span>
            </NavLink>

            {ROUTE_ENABLED.tickets && canViewTickets && (
              <NavLink 
                to="/tickets" 
                className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <Icons.Tickets />
                <span>Tickets</span>
              </NavLink>
            )}
            
            <div className={styles.navItemDisabled}>
              <Icons.AI />
              <span>AI road assistant</span>
            </div>
          </div>
        </nav>

        <div className={styles.footer}>
          <div className={styles.authContainer}>
            <Show when="signed-out">
              <Link to="/sign-in" className="auth-link" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}>Sign in</Link>
            </Show>
            <Show when="signed-in">
              <div className={styles.userProfile}>
                {/* Visible flexbox layout */}
                <div className={styles.profileContent}>
                  <div className={styles.profileText}>
                    <span className={styles.profileName}>{displayName}</span>
                    <span className={styles.profileRole}>{roleLabel}</span>
                  </div>
                  <div className={styles.profileAvatar}>
                    {user?.imageUrl ? (
                      <img src={user.imageUrl} alt={displayName} />
                    ) : (
                      <span>{displayName.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                </div>
                {/* Invisible UserButton for popover functionality */}
                <div className={styles.userButtonClickArea}>
                  <UserButton 
                    showName={false}
                    appearance={{
                      elements: {
                        userButtonBox: {
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          opacity: 0,
                          cursor: 'pointer',
                        },
                        userButtonPopoverCard: {
                          zIndex: 9999,
                        },
                        userButtonPopoverActionButton: {
                          color: '#94a3b8',
                        },
                        userButtonPopoverActionButtonText: {
                          color: '#94a3b8',
                        },
                      }
                    }} 
                  />
                </div>
              </div>
            </Show>
          </div>
        </div>
      </aside>
    </>
  );
}