/** Set d'icônes minimal en SVG inline (trait fin, cohérent avec la maquette) —
 * évite d'ajouter une dépendance externe pour une douzaine de glyphes. */

type IconProps = { size?: number; className?: string };

function base(children: React.ReactNode, { size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const GridIcon = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>,
    p,
  );

export const ChatIcon = (p: IconProps) =>
  base(<path d="M21 11.5a8.38 8.38 0 0 1-4.4 7.4A8.5 8.5 0 0 1 3 12.5 8.5 8.5 0 0 1 12 4a8.4 8.4 0 0 1 8.5 7.5z" />, p);

/** Deux bulles de discussion superposées — distingue "Groupes" (conversations
 * à plusieurs) de ChatIcon (une seule bulle) et de UsersIcon (contacts). */
export const GroupsIcon = (p: IconProps) =>
  base(
    <>
      <path d="M15 4.5H8a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h.5v2.3L11 12.5h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" />
      <path d="M6.5 8.7A2 2 0 0 0 5 10.6v3.9a2 2 0 0 0 2 2h.3V19l2.4-2.5H13a2 2 0 0 0 2-2v-.4" />
    </>,
    p,
  );

export const CameraIcon = (p: IconProps) =>
  base(
    <>
      <path d="M3 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1-2h9l1 2h2A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
      <circle cx="12" cy="13" r="3.5" />
    </>,
    p,
  );

export const BellIcon = (p: IconProps) =>
  base(
    <>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>,
    p,
  );

export const SearchIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </>,
    p,
  );

export const PhoneIcon = (p: IconProps) =>
  base(
    <path d="M5 4h3.2l1.5 4.5-2 1.5a11 11 0 0 0 5.3 5.3l1.5-2 4.5 1.5V18a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-1Z" />,
    p,
  );

export const PlusIcon = (p: IconProps) => base(<path d="M12 5v14M5 12h14" />, p);

export const SendIcon = (p: IconProps) => base(<path d="M4 12 20 4l-6.5 16-2.5-7-7-2.5Z" />, p);

export const MicIcon = (p: IconProps) =>
  base(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>,
    p,
  );

export const MicOffIcon = (p: IconProps) =>
  base(
    <>
      <path d="M9 9v2a3 3 0 0 0 4.5 2.6M15 7V6a3 3 0 0 0-5.9-.7" />
      <path d="M5 11a7 7 0 0 0 10.3 6.1M12 18v3" />
      <path d="M4 4l16 16" />
    </>,
    p,
  );

export const PhoneOffIcon = (p: IconProps) =>
  base(
    <>
      <path d="M5 4h3.2l1.5 4.5-2 1.5a11 11 0 0 0 5.3 5.3l1.5-2 4.5 1.5V18a2 2 0 0 1-2 2c-1 0-2-.15-3-.4" />
      <path d="M4 4l16 16" />
    </>,
    p,
  );

export const ImageIcon = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5.5-5.5a2 2 0 0 1 2.8 0L20 20" />
    </>,
    p,
  );

export const VideoIcon = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m21 8-5 3.5V13l5 3.5V8Z" />
    </>,
    p,
  );

export const VideoOffIcon = (p: IconProps) =>
  base(
    <>
      <path d="M3 6h9a2 2 0 0 1 2 2v1.5" />
      <path d="M14 16v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 .6-1.4" />
      <path d="m21 8-5 3.5V13l5 3.5V8Z" />
      <path d="M4 4l16 16" />
    </>,
    p,
  );

export const ChevronLeftIcon = (p: IconProps) => base(<path d="m15 5-7 7 7 7" />, p);

/** "Réduire l'appel" (voir CallOverlay/MinimizedCallBar). */
export const ChevronDownIcon = (p: IconProps) => base(<path d="m5 9 7 7 7-7" />, p);

export const CalendarIcon = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>,
    p,
  );

export const UsersIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3.2 3.2 0 0 1 0 6.2M21 20c0-2.8-2-5-4.5-5.7" />
    </>,
    p,
  );

export const InfoIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 8v.01" />
    </>,
    p,
  );

export const SettingsIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </>,
    p,
  );

export const LogOutIcon = (p: IconProps) =>
  base(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>,
    p,
  );

export const CheckIcon = (p: IconProps) => base(<path d="M5 12.5 10 17.5 19 7" />, p);

export const CheckCheckIcon = (p: IconProps) =>
  base(
    <>
      <path d="m2.5 12.5 4.5 4.5L15.5 8" />
      <path d="m9 12.5 3.5 3.5L21 7" />
    </>,
    p,
  );

export const XIcon = (p: IconProps) => base(<path d="M6 6l12 12M18 6 6 18" />, p);

export const MoreVerticalIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const TrashIcon = (p: IconProps) =>
  base(
    <>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7Z" />
      <path d="M10 11v6M14 11v6" />
    </>,
    p,
  );

export const ShareIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.7 7.6-4.4M8.2 13.3l7.6 4.4" />
    </>,
    p,
  );

export const LanguagesIcon = (p: IconProps) =>
  base(
    <>
      <path d="M4 5h9M8.5 3v2M6 5c0 4 2 6.5 5 8" />
      <path d="M4 13c2-1 4-1 5 0s3 1 5 0" />
      <path d="m14 21 4-9 4 9M15.3 18h5.4" />
    </>,
    p,
  );

export const ExpandIcon = (p: IconProps) =>
  base(
    <>
      <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
    </>,
    p,
  );

export const PlayIcon = (p: IconProps) => base(<path d="M7 5v14l12-7Z" fill="currentColor" stroke="none" />, p);

export const PauseIcon = (p: IconProps) =>
  base(
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const PersonIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" />
    </>,
    p,
  );

export const PaletteIcon = (p: IconProps) =>
  base(
    <>
      <path d="M12 3a9 8.5 0 1 0 0 17c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-3.1-2.6-5.6-9-5.6Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const LockIcon = (p: IconProps) =>
  base(
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>,
    p,
  );

export const ShieldIcon = (p: IconProps) =>
  base(<path d="M12 3.5 5 6v6c0 4.5 3 7.5 7 8.5 4-1 7-4 7-8.5V6l-7-2.5Z" />, p);

export const RefreshIcon = (p: IconProps) =>
  base(
    <>
      <path d="M4 10a8 8 0 0 1 14-5.3M20 14a8 8 0 0 1-14 5.3" />
      <path d="M18 3v5h-5M6 21v-5h5" />
    </>,
    p,
  );

/** Flèche courbe de retour — "Répondre à ce message" (glisser ou bouton, voir SwipeToReply/MessageBubble). */
export const ReplyIcon = (p: IconProps) =>
  base(<path d="M9 6 3 12l6 6M3 12h11a6 6 0 0 1 6 6v1" />, p);

export const AtSignIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4 7.5" />
    </>,
    p,
  );

export const SunIcon = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>,
    p,
  );

export const MoonIcon = (p: IconProps) =>
  base(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />, p);

export const MonitorIcon = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16.5V20" />
    </>,
    p,
  );

export const FlagIcon = (p: IconProps) =>
  base(
    <>
      <path d="M5 3v18" />
      <path d="M5 4h11l-2.5 4L16 12H5" />
    </>,
    p,
  );
