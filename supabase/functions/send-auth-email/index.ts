import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

type EmailData = {
  token?: string
  token_hash?: string
  token_new?: string
  token_hash_new?: string
  redirect_to?: string
  site_url?: string
  email_action_type?: string
  old_email?: string
}

type HookPayload = {
  user?: {
    email?: string
    new_email?: string
  }
  email_data?: EmailData
}

const jsonHeaders = { 'Content-Type': 'application/json' }

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function verifyUrl(data: EmailData, tokenHash?: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  const redirectTo = data.redirect_to || data.site_url || 'https://processedge.com.ng/sellertray'
  if (!supabaseUrl || !tokenHash || !data.email_action_type) return null

  const params = new URLSearchParams({
    token: tokenHash,
    type: data.email_action_type,
    redirect_to: redirectTo,
  })
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`
}

function emailCopy(action: string, data: EmailData, user: HookPayload['user']) {
  const link = verifyUrl(data, data.token_hash)
  const safeLink = link ? escapeHtml(link) : ''
  const newEmail = escapeHtml(user?.new_email || '')

  switch (action) {
    case 'signup':
      return {
        subject: 'Confirm your SellerTray email',
        html: `
          <h2>Confirm your email address</h2>
          <p>Confirm this email address to finish setting up your SellerTray account.</p>
          <p><a href="${safeLink}">Confirm email address</a></p>
          <p>If you did not create a SellerTray account, you can ignore this email.</p>
        `,
      }
    case 'recovery':
      return {
        subject: 'Reset your SellerTray password',
        html: `
          <h2>Reset your SellerTray password</h2>
          <p>A password reset was requested for your SellerTray account.</p>
          <p><a href="${safeLink}">Reset password</a></p>
          <p>If you did not request this reset, you can ignore this email.</p>
        `,
      }
    case 'invite':
      return {
        subject: "You're invited to SellerTray",
        html: `
          <h2>You're invited to SellerTray</h2>
          <p>You have been invited to join a SellerTray business account.</p>
          <p><a href="${safeLink}">Accept invitation</a></p>
        `,
      }
    case 'magiclink':
      return {
        subject: 'Your SellerTray sign-in link',
        html: `
          <h2>Sign in to SellerTray</h2>
          <p><a href="${safeLink}">Sign in securely</a></p>
          <p>If you did not request this link, you can ignore this email.</p>
        `,
      }
    case 'email_change':
      return {
        subject: 'Confirm your SellerTray email change',
        html: `
          <h2>Confirm your email change</h2>
          <p>Confirm the requested SellerTray email change${newEmail ? ` to <strong>${newEmail}</strong>` : ''}.</p>
          <p><a href="${safeLink}">Confirm email change</a></p>
        `,
      }
    case 'reauthentication':
      return {
        subject: 'Your SellerTray verification code',
        html: `
          <h2>SellerTray verification code</h2>
          <p>Use this code to verify your identity:</p>
          <p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(data.token || '')}</p>
        `,
      }
    case 'password_changed_notification':
      return {
        subject: 'Your SellerTray password was changed',
        html: '<h2>Password changed</h2><p>Your SellerTray password was recently changed. If this was not you, reset your password and contact ProcessEdge support immediately.</p>',
      }
    case 'email_changed_notification':
      return {
        subject: 'Your SellerTray email was changed',
        html: '<h2>Email changed</h2><p>The email address on your SellerTray account was recently changed. If this was not you, contact ProcessEdge support immediately.</p>',
      }
    default:
      return {
        subject: 'SellerTray account notification',
        html: '<h2>SellerTray account notification</h2><p>An authentication action was requested for your SellerTray account.</p>',
      }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('AUTH_EMAIL_FROM')

  if (!hookSecret || !resendApiKey || !from) {
    return new Response(JSON.stringify({ error: 'email_hook_not_configured' }), { status: 503, headers: { ...jsonHeaders, 'retry-after': '5' } })
  }

  try {
    const payloadText = await req.text()
    const headers = Object.fromEntries(req.headers)
    const secret = hookSecret.replace(/^v1,whsec_/, '')
    const verified = new Webhook(secret).verify(payloadText, headers) as HookPayload

    const email = verified.user?.email
    const data = verified.email_data
    const action = data?.email_action_type || ''

    if (!email || !data) {
      return new Response(JSON.stringify({ error: 'invalid_hook_payload' }), { status: 400, headers: jsonHeaders })
    }

    const copy = emailCopy(action, data, verified.user)
    const shell = `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#17202a">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px">
            <tr><td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
                <tr><td>
                  <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0056A6">SellerTray by ProcessEdge</p>
                  <div style="font-size:15px;line-height:1.65">${copy.html}</div>
                  <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#7b8794">
                    <a href="https://processedge.com.ng/sellertray/privacy">Privacy</a> ·
                    <a href="https://processedge.com.ng/sellertray/terms">Terms</a>
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </body>
      </html>
    `

    const providerResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: copy.subject,
        html: shell,
      }),
      signal: AbortSignal.timeout(3500),
    })

    if (!providerResponse.ok) {
      const providerStatus = providerResponse.status
      console.error(JSON.stringify({ event: 'auth_email_provider_error', provider: 'resend', action, providerStatus }))
      return new Response(
        JSON.stringify({ error: 'email_provider_failure' }),
        { status: providerStatus === 429 ? 429 : 503, headers: { ...jsonHeaders, 'retry-after': '5' } },
      )
    }

    console.log(JSON.stringify({ event: 'auth_email_sent', provider: 'resend', action }))
    return new Response(JSON.stringify({}), { status: 200, headers: jsonHeaders })
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth_email_hook_error', message: error instanceof Error ? error.message : 'unknown_error' }))
    return new Response(JSON.stringify({ error: 'invalid_hook_request' }), { status: 401, headers: jsonHeaders })
  }
})
