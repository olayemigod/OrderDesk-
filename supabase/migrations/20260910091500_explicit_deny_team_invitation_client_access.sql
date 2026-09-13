drop policy if exists tenant_invitations_deny_authenticated on public.tenant_invitations;
create policy tenant_invitations_deny_authenticated
on public.tenant_invitations
for all
to authenticated
using (false)
with check (false);
