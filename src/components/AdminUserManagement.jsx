import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { useAppRole } from '../auth/roles';
import styles from './AdminUserManagement.module.css';

export default function AdminUserManagement({ onActionComplete }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { isLoaded: roleLoaded, role } = useAppRole();
  const canAdmin = roleLoaded && role === 'admin';
  
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [newRole, setNewRole] = useState('user');
  
  // Fetch users (only for admins)
  useEffect(() => {
    if (!canAdmin || !isLoaded) return;
    
    const fetchUsers = async () => {
      setIsLoading(true);
      setError('');
      try {
        const token = isSignedIn ? await getToken() : null;
        const response = await fetch('/api/users', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        
        if (!response.ok) throw new Error('Failed to fetch users');
        const data = await response.json();
        setUsers(Array.isArray(data) ? data : data.users || []);
      } catch (err) {
        setError(err.message || 'Failed to load users');
      } finally {
        setIsLoading(false);
      }
    };
    
    void fetchUsers();
  }, [canAdmin, isLoaded, isSignedIn, getToken]);
  
  const handleRoleChange = async (userId, role) => {
    try {
      const token = isSignedIn ? await getToken() : null;
      const response = await fetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: {
          ...((token) ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role }),
      });
      
      if (!response.ok) throw new Error('Failed to update role');
      
      // Update local state
      setUsers(users.map(u => u.id === userId ? { ...u, role } : u));
      setShowRoleModal(false);
      if (onActionComplete) onActionComplete();
    } catch (err) {
      setError(err.message || 'Failed to change role');
    }
  };
  
  const handleBlockUser = async (userId) => {
    try {
      const token = isSignedIn ? await getToken() : null;
      const response = await fetch(`/api/users/${userId}/block`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      
      if (!response.ok) throw new Error('Failed to block user');
      
      // Update local state
      setUsers(users.map(u => u.id === userId ? { ...u, deleted_at: new Date().toISOString() } : u));
      setShowBlockModal(false);
      if (onActionComplete) onActionComplete();
    } catch (err) {
      setError(err.message || 'Failed to block user');
    }
  };
  
  const handleUnblockUser = async (userId) => {
    try {
      const token = isSignedIn ? await getToken() : null;
      const response = await fetch(`/api/users/${userId}/unblock`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      
      if (!response.ok) throw new Error('Failed to unblock user');
      
      // Update local state
      setUsers(users.map(u => u.id === userId ? { ...u, deleted_at: null } : u));
      if (onActionComplete) onActionComplete();
    } catch (err) {
      setError(err.message || 'Failed to unblock user');
    }
  };
  
  const getRoleDisplay = (role) => {
    switch (role) {
      case 'user': return 'Member';
      case 'authority': return 'Enforcer';
      case 'admin': return 'Admin';
      default: return role;
    }
  };
  
  const getStatusBadge = (user) => {
    if (user.deleted_at) {
      return <span className={styles.statusBadge + ' ' + styles.blocked}>Blocked</span>;
    }
    return <span className={styles.statusBadge + ' ' + styles.active}>Active</span>;
  };
  
  if (!canAdmin) return null;
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>User Management</h2>
        <p className={styles.subtitle}>Manage user roles and account status</p>
      </div>
      
      {error && <p className={styles.error}>{error}</p>}
      
      {isLoading ? (
        <div className={styles.loading}>Loading users...</div>
      ) : (
        <div className={styles.userList}>
          {users.length === 0 ? (
            <div className={styles.emptyState}>No users found</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={styles.tableRow}>
                    <td className={styles.userCell}>
                      <div className={styles.userAvatar}>
                        {user.image_url ? (
                          <img src={user.image_url} alt="User avatar" />
                        ) : (
                          <div className={styles.avatarPlaceholder}>
                            {user.first_name?.[0] || 'U'}
                          </div>
                        )}
                      </div>
                      <div className={styles.userInfo}>
                        <div className={styles.userName}>
                          {user.first_name} {user.last_name}
                        </div>
                        <div className={styles.userEmail}>{user.id}</div>
                      </div>
                    </td>
                    <td className={styles.roleCell}>
                      <span className={styles.roleBadge}>
                        {getRoleDisplay(user.role)}
                      </span>
                    </td>
                    <td className={styles.statusCell}>
                      {getStatusBadge(user)}
                    </td>
                    <td className={styles.actionsCell}>
                      <button 
                        className={styles.actionButton}
                        onClick={() => {
                          setSelectedUser(user);
                          setNewRole(user.role);
                          setShowRoleModal(true);
                        }}
                        aria-label="Change role"
                      >
                        Change Role
                      </button>
                      {user.deleted_at ? (
                        <button 
                          className={`${styles.actionButton} ${styles.unblockButton}`}
                          onClick={() => handleUnblockUser(user.id)}
                          aria-label="Unblock user"
                        >
                          Unblock
                        </button>
                      ) : (
                        <button 
                          className={`${styles.actionButton} ${styles.blockButton}`}
                          onClick={() => {
                            setSelectedUser(user);
                            setShowBlockModal(true);
                          }}
                          aria-label="Block user"
                        >
                          Block
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      
      {/* Role Change Modal */}
      {showRoleModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>Change Role for {selectedUser.first_name} {selectedUser.last_name}</h3>
              <button 
                className={styles.closeButton}
                onClick={() => setShowRoleModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.label}>New Role:</label>
              <select 
                className={styles.select}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="user">Member</option>
                <option value="authority">Enforcer</option>
                <option value="admin">Admin</option>
              </select>
              <p className={styles.warning}>
                Note: You cannot downgrade your own role.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowRoleModal(false)}
              >
                Cancel
              </button>
              <button 
                className={styles.confirmButton}
                onClick={() => handleRoleChange(selectedUser.id, newRole)}
              >
                Update Role
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Block User Modal */}
      {showBlockModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>Block User</h3>
              <button 
                className={styles.closeButton}
                onClick={() => setShowBlockModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>
                Are you sure you want to block <strong>{selectedUser.first_name} {selectedUser.last_name}</strong>? 
                This will prevent them from creating reports and accessing the system.
              </p>
              <p className={styles.warning}>
                Note: You cannot block yourself. This action cannot be undone without admin intervention.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowBlockModal(false)}
              >
                Cancel
              </button>
              <button 
                className={`${styles.confirmButton} ${styles.dangerButton}`}
                onClick={() => handleBlockUser(selectedUser.id)}
              >
                Block User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}