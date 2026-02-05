/**
 * TabButton Component
 * 
 * A reusable tab button for the preferences dialog tab bar.
 */

import React from 'react';
import './TabButton.css';

interface TabButtonProps {
  id: string;
  label: string;
  icon?: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

function TabButton({
  id,
  label,
  icon,
  isActive,
  onClick,
}: TabButtonProps): React.JSX.Element {
  return (
    <button
      id={`tab-${id}`}
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-${id}`}
      className={`tab-button ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      {icon && <span className="tab-icon">{icon}</span>}
      {label}
    </button>
  );
}

export { TabButton };
