import React, { useState, useEffect } from 'react';
import { AppProvider } from './contexts';
import { AppHeader, LeftPanel, RightPanel } from './components';
import { ErrorBoundary } from './components/ui';
import { UpdateNotification } from './features/auto-update';
import { SetupWizard } from './features/setup';
import { checkPythonStatus } from './services/electronAPI';
import './App.css';

function App(): React.JSX.Element {
  const [showSetupWizard, setShowSetupWizard] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if Python is installed on app start
    checkPythonStatus()
      .then((status) => {
        // Show wizard if Python or packages aren't installed
        setShowSetupWizard(!status.installed || !status.packagesInstalled);
      })
      .catch(() => {
        // If check fails, assume we need setup
        setShowSetupWizard(true);
      });
  }, []);

  const handleSetupComplete = (): void => {
    setShowSetupWizard(false);
  };

  const handleSetupSkip = (): void => {
    setShowSetupWizard(false);
  };

  return (
    <ErrorBoundary>
      <AppProvider>
        <div className="app">
          <AppHeader />

          <main className="app-main">
            <LeftPanel />
            <RightPanel />
          </main>

          <UpdateNotification />

          {/* Show setup wizard when Python is not installed */}
          {showSetupWizard && (
            <SetupWizard onComplete={handleSetupComplete} onSkip={handleSetupSkip} />
          )}
        </div>
      </AppProvider>
    </ErrorBoundary>
  );
}

export { App };
