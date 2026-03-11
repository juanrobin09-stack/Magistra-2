import React, { createContext, useContext } from 'react';
import { useUser } from '@clerk/clerk-react';

type AuthUser = ReturnType<typeof useUser>['user'];

interface AuthCtx {
  user: AuthUser;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}

export const AuthContext = createContext<AuthCtx>({
  user: null,
  isLoaded: true,
  isSignedIn: false,
});

// Must be rendered inside <ClerkProvider>
export function ClerkUserBridge({ children }: { children: React.ReactNode }) {
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoaded, isSignedIn }}>
      {children}
    </AuthContext.Provider>
  );
}

export function NoAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: null, isLoaded: true, isSignedIn: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(AuthContext);
}
