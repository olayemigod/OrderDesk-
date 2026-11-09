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

function cleanEmailHeader(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

function sellerTraySender(value: string) {
  const clean = cleanEmailHeader(value)
  if (!clean) return ''
  const addressMatch = clean.match(/<([^<>]+)>\s*$/)
  const address = (addressMatch?.[1] ?? clean).trim().toLowerCase()
  if (!address || address.length > 320 || !address.includes('@')) return ''
  return `SellerTray <${address}>`
}

function verifyUrl(data: EmailData, tokenHash?: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  const redirectTo = data.redirect_to || data.site_url || 'https://app.sellertray.com'
  if (!supabaseUrl || !tokenHash || !data.email_action_type) return null

  const params = new URLSearchParams({
    token: tokenHash,
    type: data.email_action_type,
    redirect_to: redirectTo,
  })
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`
}

function emailCopy(action: string, data: EmailData, user: HookPayload['user']) {
  const link = verifyUrl(data, action === 'email_change' && data.token_hash_new ? data.token_hash_new : data.token_hash)
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
          <p>You have been invited to join a SellerTray account.</p>
          <p><a href="${safeLink}">Review invitation</a></p>
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
        html: '<h2>Password changed</h2><p>Your SellerTray password was recently changed. If this was not you, reset your password and contact SellerTray support immediately.</p>',
      }
    case 'email_changed_notification':
      return {
        subject: 'Your SellerTray email was changed',
        html: '<h2>Email changed</h2><p>The email address on your SellerTray account was recently changed. If this was not you, contact SellerTray support immediately.</p>',
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
  const from = sellerTraySender(
    Deno.env.get('SELLERTRAY_EMAIL_FROM')
      ?? Deno.env.get('AUTH_EMAIL_FROM')
      ?? ''
  )

  if (!hookSecret || !resendApiKey || !from) {
    return new Response(JSON.stringify({ error: 'email_hook_not_configured' }), { status: 503, headers: { ...jsonHeaders, 'retry-after': '5' } })
  }

  let verifiedHookRequest = false
  try {
    const payloadText = await req.text()
    const headers = Object.fromEntries(req.headers)
    const secret = hookSecret.replace(/^v1,whsec_/, '')
    const verified = new Webhook(secret).verify(payloadText, headers) as HookPayload
    verifiedHookRequest = true

    const data = verified.email_data
    const action = data?.email_action_type || ''
    const secureEmailChange = Boolean(
      action === 'email_change' &&
      verified.user?.email &&
      verified.user?.new_email &&
      data?.token_hash &&
      data?.token_hash_new
    )
    const email = action === 'email_change' && !secureEmailChange && verified.user?.new_email
      ? verified.user.new_email
      : verified.user?.email

    if (!email || !data) {
      return new Response(JSON.stringify({ error: 'invalid_hook_payload' }), { status: 400, headers: jsonHeaders })
    }

    const copy = emailCopy(action, data, verified.user)
    const shell = (content: string) => `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#17202a">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px">
            <tr><td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
                <tr><td>
                  <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#12B76A">SellerTray</p>
                  <div style="font-size:15px;line-height:1.65">${content}</div>
                  <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#7b8794">
                    <a href="https://sellertray.com/privacy">Privacy</a> ·
                    <a href="https://sellertray.com/terms">Terms</a><br />
                    SellerTray is a ProcessEdge product.
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </body>
      </html>
    `

    const messages = [{ to: email, subject: copy.subject, html: shell(copy.html) }]

    if (secureEmailChange && verified.user?.new_email) {
      const newEmailLink = verifyUrl(data, data.token_hash)
      if (!newEmailLink) {
        return new Response(JSON.stringify({ error: 'invalid_email_change_payload' }), { status: 400, headers: jsonHeaders })
      }

      messages.push({
        to: verified.user.new_email,
        subject: 'Confirm your new SellerTray email',
        html: shell(
          '<h2>Confirm your new email address</h2>' +
          '<p>Confirm <strong>' + escapeHtml(verified.user.new_email) + '</strong> as the new sign-in email for your SellerTray account.</p>' +
          '<p><a href="' + escapeHtml(newEmailLink) + '">Confirm new email address</a></p>'
        ),
      })
    }

    const providerResponses = await Promise.all(messages.map((message) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
        }),
        signal: AbortSignal.timeout(3500),
      })
    ))

    const failedResponse = providerResponses.find((response) => !response.ok)
    if (failedResponse) {
      const providerStatus = failedResponse.status
      console.error(JSON.stringify({ event: 'auth_email_provider_error', provider: 'resend', action, providerStatus }))
      return new Response(
        JSON.stringify({ error: 'email_provider_failure' }),
        { status: providerStatus === 429 ? 429 : 503, headers: { ...jsonHeaders, 'retry-after': '5' } },
      )
    }

    // A provider HTTP 2xx means Resend accepted the message(s), not that a
    // recipient's email provider delivered them to their mailbox.
    const providerMessageIds = await Promise.all(providerResponses.map(async (response) => {
      const receipt = await response.json().catch(() => null) as { id?: unknown } | null
      return typeof receipt?.id === 'string' && /^[a-zA-Z0-9_-]{6,100}$/.test(receipt.id)
        ? receipt.id
        : null
    }))
    console.log(JSON.stringify({
      event: 'auth_email_sent', // preserved event identifier for existing dashboards
      provider: 'resend',
      action,
      messageCount: messages.length,
      providerMessageIds,
      providerAccepted: true,
      recipientDeliveryVerified: false,
    }))
    return new Response(JSON.stringify({}), { status: 200, headers: jsonHeaders })
  } catch (error) {
    // Invalid signatures are auth failures; an error *after* verification is
    // operational/provider uncertainty. Mislabeling a timeout as a 401 hides
    // delivery failures and can prevent safe diagnosis/retry.
    const responseStatus = verifiedHookRequest ? 503 : 401
    console.error(JSON.stringify({
      event: verifiedHookRequest ? 'auth_email_provider_request_uncertain' : 'auth_email_hook_auth_failed',
      failureClass: error instanceof Error ? error.name : 'unknown',
      providerAccepted: false,
      recipientDeliveryVerified: false,
    }))
    return new Response(
      JSON.stringify({ error: verifiedHookRequest ? 'email_provider_request_uncertain' : 'invalid_hook_request' }),
      { status: responseStatus, headers: responseStatus === 503 ? { ...jsonHeaders, 'retry-after': '5' } : jsonHeaders },
    )
  }
})
