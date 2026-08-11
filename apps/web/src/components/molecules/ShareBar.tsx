'use client';

import { useEffect, useState } from 'react';

interface ShareBarProps {
  url?: string;
  title?: string;
  className?: string;
}

export function ShareBar({ url: propUrl, title: propTitle, className = '' }: ShareBarProps) {
  const [url, setUrl] = useState(propUrl ?? '');
  const [title, setTitle] = useState(propTitle ?? '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!propUrl) setUrl(window.location.href);
    if (!propTitle) setTitle(document.title);
  }, [propUrl, propTitle]);

  const shareUrl = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer,width=600,height=400');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const redditHref = `https://www.reddit.com/submit?title=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        share
      </span>
      <ShareButton
        href={twitterHref}
        onClick={(e) => {
          e.preventDefault();
          shareUrl(twitterHref);
        }}
        label="X"
        icon={<XIcon />}
      />
      <ShareButton
        href={linkedinHref}
        onClick={(e) => {
          e.preventDefault();
          shareUrl(linkedinHref);
        }}
        label="LinkedIn"
        icon={<LinkedInIcon />}
      />
      <ShareButton
        href={redditHref}
        onClick={(e) => {
          e.preventDefault();
          shareUrl(redditHref);
        }}
        label="Reddit"
        icon={<RedditIcon />}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-2 border border-[var(--color-line)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]"
        aria-label="Copy link"
      >
        <LinkIcon className="size-3.5" />
        {copied ? 'copied' : 'copy link'}
      </button>
    </div>
  );
}

function ShareButton({
  href,
  onClick,
  label,
  icon,
}: {
  href: string;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex size-7 items-center justify-center border border-[var(--color-line)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]"
      aria-label={`Share on ${label}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {icon}
    </a>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.74-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.061 1.614a3.111 3.111 0 0 1 .122.637c0 2.144-2.524 3.881-5.636 3.881-3.112 0-5.636-1.737-5.636-3.881 0-.219.029-.436.088-.645-.608-.288-1.03-.9-1.03-1.625 0-.968.786-1.754 1.754-1.754.467 0 .899.182 1.208.49 1.186-.851 2.83-1.412 4.647-1.485l.885-4.182a.343.343 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.706.568c.315-.63.96-1.063 1.701-1.063zM9.06 13.852c-.686 0-1.242.56-1.242 1.243 0 .684.556 1.242 1.242 1.242.685 0 1.242-.558 1.242-1.242 0-.683-.557-1.243-1.242-1.243zm5.879 0c-.686 0-1.242.56-1.242 1.243 0 .684.556 1.242 1.242 1.242.685 0 1.242-.558 1.242-1.242 0-.683-.557-1.243-1.242-1.243z" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className ?? ''} fill-none stroke-current`}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 0 0-5.656 0l-3 3a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l3-3a4 4 0 0 0-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}
