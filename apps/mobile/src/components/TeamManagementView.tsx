import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import type { TeamInviteRole, TeamInvitation, TeamMember } from '../data/teamRepository';
import { useTeam } from '../hooks/useTeam';

type Props = {
  business: MerchantBusiness;
};

export function TeamManagementView({ business }: Props) {
  const { team, loading, busy, error, refresh, invite, setRole, remove, cancelInvitation } = useTeam(business.id);
  const [email, setEmail] = useState('');
  const [role, setRoleDraft] = useState<TeamInviteRole>(business.role === 'manager' ? 'staff' : 'staff');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setEmail('');
    setRoleDraft('staff');
    setNotice(null);
  }, [business.id]);

  const canManage = business.role === 'owner' || business.role === 'manager';

  async function submitInvite() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setNotice(null);
      return;
    }

    setNotice(null);
    try {
      const outcome = await invite(cleanEmail, role);
      setEmail('');
      setNotice(
        outcome === 'joined'
          ? 'Existing OrderDesk user added to the team.'
          : 'Invitation saved. Ask this person to create/sign in to OrderDesk with the same email; the business will attach automatically.',
      );
    } catch {
      // Hook exposes the server error below.
    }
  }

  function confirmRemove(member: TeamMember) {
    Alert.alert(
      'Remove team member?',
      `${member.email} will lose access to ${business.name}.`,
      [
        { text: 'Keep member', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            void remove(member.userId).catch(() => undefined);
          },
        },
      ],
    );
  }

  if (loading && !team) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.helper}>Loading team…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>TEAM ACCESS</Text>
        <Text style={styles.title}>People and roles</Text>
        <Text style={styles.helper}>
          Staff can run day-to-day order workflows. Managers can also maintain business/catalogue settings and manage Staff. Owners retain protected account control.
        </Text>
      </View>

      {team ? (
        <View style={styles.memberList}>
          {team.members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              actorUserId={team.actorUserId}
              actorRole={team.actorRole}
              busy={busy}
              onSetRole={(nextRole) => {
                setNotice(null);
                void setRole(member.userId, nextRole).catch(() => undefined);
              }}
              onRemove={() => confirmRemove(member)}
            />
          ))}
        </View>
      ) : null}

      {canManage ? (
        <View style={styles.inviteBox}>
          <Text style={styles.inviteTitle}>Add a team member</Text>
          <TextInput
            editable={!busy}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="staff@business.com"
            style={styles.input}
          />
          <View style={styles.roleRow}>
            {business.role === 'owner' ? (
              <RoleButton label="Manager" active={role === 'manager'} disabled={busy} onPress={() => setRoleDraft('manager')} />
            ) : null}
            <RoleButton label="Staff" active={role === 'staff'} disabled={busy} onPress={() => setRoleDraft('staff')} />
          </View>
          <Pressable
            disabled={busy || !email.trim()}
            onPress={() => void submitInvite()}
            style={({ pressed }) => [styles.primaryButton, (busy || !email.trim()) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Working…' : 'Add / invite member'}</Text>
          </Pressable>
          <Text style={styles.inviteHelper}>
            If the email already belongs to an OrderDesk account, access is added immediately. Otherwise a 7-day pending invitation is created. Automatic invitation email delivery will be enabled with production SMTP.
          </Text>
        </View>
      ) : (
        <View style={styles.readOnlyBox}>
          <Text style={styles.readOnlyTitle}>Team roster is view only</Text>
          <Text style={styles.helper}>Staff cannot invite, remove or change team roles.</Text>
        </View>
      )}

      {team && team.invitations.length > 0 ? (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingTitle}>Pending invitations</Text>
          {team.invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              canCancel={canCancelInvitation(team.actorRole, invitation)}
              busy={busy}
              onCancel={() => {
                setNotice(null);
                void cancelInvitation(invitation.id).catch(() => undefined);
              }}
            />
          ))}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void refresh()}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function MemberRow({
  member,
  actorUserId,
  actorRole,
  busy,
  onSetRole,
  onRemove,
}: {
  member: TeamMember;
  actorUserId: string;
  actorRole: 'owner' | 'manager' | 'staff';
  busy: boolean;
  onSetRole: (role: TeamInviteRole) => void;
  onRemove: () => void;
}) {
  const isSelf = member.userId === actorUserId;
  const ownerProtected = member.role === 'owner';
  const ownerCanManage = actorRole === 'owner' && !isSelf && !ownerProtected;
  const managerCanManage = actorRole === 'manager' && !isSelf && member.role === 'staff';
  const canRemove = ownerCanManage || managerCanManage;

  return (
    <View style={styles.memberRow}>
      <View style={styles.memberCopy}>
        <Text style={styles.memberEmail}>{member.email}{isSelf ? ' · You' : ''}</Text>
        <Text style={styles.memberMeta}>{formatRole(member.role)} · joined {formatDate(member.joinedAt)}</Text>
      </View>
      <View style={styles.memberActions}>
        {ownerCanManage ? (
          <Pressable
            disabled={busy}
            onPress={() => onSetRole(member.role === 'manager' ? 'staff' : 'manager')}
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>{member.role === 'manager' ? 'Make Staff' : 'Make Manager'}</Text>
          </Pressable>
        ) : null}
        {canRemove ? (
          <Pressable disabled={busy} onPress={onRemove} style={styles.removeButton}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function InvitationRow({
  invitation,
  canCancel,
  busy,
  onCancel,
}: {
  invitation: TeamInvitation;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <View style={styles.invitationRow}>
      <View style={styles.memberCopy}>
        <Text style={styles.memberEmail}>{invitation.email}</Text>
        <Text style={styles.memberMeta}>{formatRole(invitation.role)} · expires {formatDate(invitation.expiresAt)}</Text>
      </View>
      {canCancel ? (
        <Pressable disabled={busy} onPress={onCancel} style={styles.removeButton}>
          <Text style={styles.removeText}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function RoleButton({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.roleButton, active && styles.roleButtonActive]}>
      <Text style={[styles.roleText, active && styles.roleTextActive]}>{label}</Text>
    </Pressable>
  );
}

function canCancelInvitation(actorRole: 'owner' | 'manager' | 'staff', invitation: TeamInvitation): boolean {
  return actorRole === 'owner' || (actorRole === 'manager' && invitation.role === 'staff');
}

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 14 },
  heading: { gap: 4 },
  eyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 16, fontWeight: '900' },
  helper: { color: '#667085', fontSize: 10, lineHeight: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  memberList: { gap: 0, borderWidth: 1, borderColor: '#EAECF0', borderRadius: 12, overflow: 'hidden' },
  memberRow: { padding: 11, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EAECF0' },
  invitationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  memberCopy: { flex: 1 },
  memberEmail: { color: '#101828', fontSize: 11, fontWeight: '800' },
  memberMeta: { color: '#667085', fontSize: 9, marginTop: 3 },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  smallButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9 },
  smallButtonText: { color: '#344054', fontSize: 9, fontWeight: '800' },
  removeButton: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 3 },
  removeText: { color: '#B42318', fontSize: 9, fontWeight: '800' },
  inviteBox: { backgroundColor: '#F9FAFB', borderRadius: 13, padding: 12, gap: 9 },
  inviteTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 11, color: '#101828' },
  roleRow: { flexDirection: 'row', gap: 7 },
  roleButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: '#FFFFFF' },
  roleButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  roleText: { color: '#667085', fontSize: 10, fontWeight: '800' },
  roleTextActive: { color: '#175CD3' },
  primaryButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  inviteHelper: { color: '#667085', fontSize: 9, lineHeight: 14 },
  readOnlyBox: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 11 },
  readOnlyTitle: { color: '#344054', fontSize: 11, fontWeight: '900', marginBottom: 2 },
  pendingSection: { gap: 3 },
  pendingTitle: { color: '#344054', fontSize: 11, fontWeight: '900' },
  errorBox: { backgroundColor: '#FEF3F2', borderRadius: 11, padding: 10, gap: 4 },
  error: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  retry: { color: '#B42318', fontSize: 10, fontWeight: '900' },
  notice: { color: '#027A48', fontSize: 10, lineHeight: 15, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
