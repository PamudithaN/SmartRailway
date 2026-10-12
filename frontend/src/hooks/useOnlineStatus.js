import { useEffect, useState } from 'react';
import { isOnline, subscribe } from '../lib/network';

const useOnlineStatus = () => {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => subscribe(setOnline), []);
  return online;
};

export default useOnlineStatus;
