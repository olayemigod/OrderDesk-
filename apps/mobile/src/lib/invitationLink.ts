import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

const PENDING_INVITATION_KEY = 'sellertray.pendingInvitationId';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CUSTOM_INVITATION_RE = new RegExp(`^(?:sellertray|orderdesk):\\/\\/invite\\/(${UUID_PATTERN})(?:[/?#]|$)`, 'i');
const CANONICAL_INVITATION_RE = new RegExp(`^https:\\/\\/app\\.sellertray\\.com\\/invite(?:\\.html)?(?:\\?|\\/)(?:invitation=)?(${UUID_PATTERN})(?:[&#/?]|$)`, 'i');

export function invitationIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim();

  const customMatch = clean.match(CUSTOM_INVITATION_RE);
  if (customMatch?.[1]) return customMatch[1].toLowerCase();

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'app.sellertray.com') return null;

    if (parsed.pathname === '/invite.html' || parsed.pathname === '/invite') {
      const queryInvitation = parsed.searchParams.get('invitation');
      return cleanInvitationId(queryInvitation);
    }

    const pathMatch = parsed.pathname.match(new RegExp(`^/invite/(${UUID_PATTERN})/?$`, 'i'));
    return cleanInvitationId(pathMatch?.[1] ?? null);
  } catch {
    const canonicalMatch = clean.match(CANONICAL_INVITATION_RE);
    return cleanInvitationId(canonicalMatch?.[1] ?? null);
  }
}

export function useInvitationLink() {
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const rememberUrl = useCallback(async (url: string | null | undefined) => {
    const nextId = invitationIdFromUrl(url);
    if (!nextId) return false;
    setInvitationId(nextId);
    await AsyncStorage.setItem(PENDING_INVITATION_KEY, nextId);
    return true;
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const [stored, initialUrl] = await Promise.all([
        AsyncStorage.getItem(PENDING_INVITATION_KEY),
        Linking.getInitialURL(),
      ]);
      if (!active) return;

      const initialId = invitationIdFromUrl(initialUrl);
      const storedId = cleanInvitationId(stored);
      const nextId = initialId ?? storedId;
      if (nextId) {
        setInvitationId(nextId);
        await AsyncStorage.setItem(PENDING_INVITATION_KEY, nextId);
      }
      if (active) setReady(true);
    }

    void bootstrap();
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void rememberUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [rememberUrl]);

  const clearInvitation = useCallback(async (resolvedInvitationId?: string) => {
    if (resolvedInvitationId && invitationId && resolvedInvitationId !== invitationId) return;
    setInvitationId(null);
    await AsyncStorage.removeItem(PENDING_INVITATION_KEY);
  }, [invitationId]);

  return { invitationId, ready, clearInvitation, rememberUrl };
}

function cleanInvitationId(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  return new RegExp(`^${UUID_PATTERN}$`, 'i').test(clean) ? clean : null;
}
