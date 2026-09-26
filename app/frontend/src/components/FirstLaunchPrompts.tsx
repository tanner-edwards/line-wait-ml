// Both first-launch soft prompts fire on the same trigger (onboarding sets a
// persona, user lands on Home), and each one ends by raising a native OS
// permission dialog. iOS presents one system alert at a time: a location
// request raised while the notification alert is still up gets dropped and
// comes back UNDETERMINED, so the prompt appears to do nothing at all.
//
// So they run in sequence — location only mounts once notifications have
// resolved, which includes waiting for that dialog to close.

import React, { useCallback, useState } from 'react';
import { FirstLaunchNotifPrompt } from './FirstLaunchNotifPrompt';
import { FirstLaunchLocationPrompt } from './FirstLaunchLocationPrompt';

export function FirstLaunchPrompts(): React.ReactElement {
  const [notifResolved, setNotifResolved] = useState(false);
  const handleNotifResolved = useCallback(() => setNotifResolved(true), []);

  return (
    <>
      <FirstLaunchNotifPrompt onResolved={handleNotifResolved} />
      {notifResolved ? <FirstLaunchLocationPrompt /> : null}
    </>
  );
}
