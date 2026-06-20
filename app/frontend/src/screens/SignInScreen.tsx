// Sign-in screen — shown when no Firebase user is present.
// Single CTA: Sign in with Apple. No email/password, no "guest" mode.
// On success the Firebase Auth listener in AuthContext takes over and
// RootNavigator routes the user to onboarding (first launch) or the main app.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  OAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { auth } from '../firebase';
import { colors, spacing, typography } from '../theme/tokens';
import { LinearGradient } from 'expo-linear-gradient';

export function SignInScreen(): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAppleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const provider = new OAuthProvider('apple.com');
      const firebaseCred = provider.credential({
        idToken: credential.identityToken!,
        rawNonce: credential.authorizationCode ?? undefined,
      });
      await signInWithCredential(auth, firebaseCred);
      // AuthContext's onAuthStateChanged fires next — no manual state update needed.
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_REQUEST_CANCELED') {
        // User dismissed the sheet — not an error.
      } else {
        setError('Sign in failed. Please try again.');
        console.warn('[SignInScreen] Apple sign-in error:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.gradientFrom, colors.gradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      />

      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.appName}>Club 32</Text>
          <Text style={styles.tagline}>
            Know when to go before the crowds do.
          </Text>
        </View>

        <View style={styles.cta}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator size="large" color={colors.textInverse} />
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={14}
              style={styles.appleBtn}
              onPress={() => void handleAppleSignIn()}
            />
          )}

          <Text style={styles.legal}>
            By continuing you agree to the Terms of Service and Privacy Policy.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gradientFrom },
  gradient: { ...StyleSheet.absoluteFillObject },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
    paddingBottom: spacing.xxxl,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  appName: {
    ...typography.screenTitle,
    fontSize: 48,
    color: colors.textInverse,
    letterSpacing: -1.5,
  },
  tagline: {
    ...typography.body,
    fontSize: 17,
    color: colors.textInverseMuted,
    textAlign: 'center',
    lineHeight: 26,
  },
  cta: {
    gap: spacing.base,
    alignItems: 'center',
  },
  appleBtn: {
    width: '100%',
    height: 54,
  },
  error: {
    ...typography.label,
    color: '#FCA5A5',
    textAlign: 'center',
  },
  legal: {
    ...typography.caption,
    color: colors.textInverseMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
});
