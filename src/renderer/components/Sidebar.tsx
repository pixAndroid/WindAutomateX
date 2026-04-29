import React from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/tasks', label: 'Task Manager', icon: '📋' },
  { path: '/actions', label: 'Actions', icon: '⚡' },
  { path: '/scheduler', label: 'Scheduler', icon: '🕐' },
  { path: '/logs', label: 'Logs', icon: '📄' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 bg-gray-800 flex flex-col h-full shadow-xl">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-xl font-bold text-blue-400">WindAutomateX</h1>
        <p className="text-xs text-gray-400 mt-1">Windows Automation</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-700">
        <p className="text-xs text-gray-500 text-center">v1.0.0</p>
      </div>
    </aside>
  );
};

export default Sidebar;
