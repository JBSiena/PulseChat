import nodemailer from 'nodemailer'

const smtpHost = process.env.SMTP_HOST
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const smtpSecure = process.env.SMTP_SECURE === 'true'
const fromAddress = process.env.EMAIL_FROM || smtpUser || 'no-reply@pulsechat.local'

function isSmtpConfigured() {
  return Boolean(smtpHost && smtpUser && smtpPass)
}

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (!isSmtpConfigured()) {
    return null
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  }
  return transporter
}

export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
}) {
  const { to, subject, text, html } = params

  const t = getTransporter()
  if (!t) {
    console.warn(
      'SMTP is not fully configured. Email will not be sent. Intended message:',
      { to, subject, text },
    )
    return
  }

  await t.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html: html ?? text,
  })
}

export async function sendVerificationCodeEmail(params: { to: string; code: string }) {
  const { to, code } = params
  const subject = 'Your PulseChat verification code'
  const text = `Your PulseChat verification code is ${code}. It will expire in 15 minutes. If you did not sign up for PulseChat, please ignore this email.`
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DEV ONLY] Verification code generated', { to, code })
  }

  await sendEmail({ to, subject, text })
}

export async function sendPasswordResetEmail(params: { to: string; token: string }) {
  const { to, token } = params
  const subject = 'Your PulseChat password reset code'
  const text = `You requested to reset your PulseChat password.\n\nUse this reset code: ${token}\n\nIf you did not request this, you can ignore this email.`
  await sendEmail({ to, subject, text })
}
