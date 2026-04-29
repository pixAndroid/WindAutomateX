import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import TaskManager from './pages/TaskManager';
import TaskBuilder from './pages/TaskBuilder';
import SchedulerPage from './pages/SchedulerPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';
import ActionsPage from './pages/ActionsPage';

const App: React.FC = () => {
  return (
    <ToastProvider>
      <HashRouter>
        <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tasks" element={<TaskManager />} />
              <Route path="/tasks/new" element={<TaskBuilder />} />
              <Route path="/tasks/:id/edit" element={<TaskBuilder />} />
              <Route path="/scheduler" element={<SchedulerPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/actions" element={<ActionsPage />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </ToastProvider>
  );
};

export default App;
