/* Small stroke icons (24x24, they take their color from the text color). Decorative by default:
   pass a `label` to make one meaningful for screen readers. */
function Svg({ size = 24, label, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : 'true'} {...rest}>
      {children}
    </svg>
  );
}

export const SearchIcon = (p) => <Svg strokeWidth="2" {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Svg>;
export const CartIcon = (p) => <Svg strokeWidth="2" {...p}><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></Svg>;
export const GamepadIcon = (p) => <Svg {...p}><path d="M6 8h12a4 4 0 0 1 3.9 4.9l-.9 4a2.6 2.6 0 0 1-4.3 1.3L15 17H9l-1.7 1.2A2.6 2.6 0 0 1 3 16.9l-.9-4A4 4 0 0 1 6 8z" /><path d="M8 11v4M6 13h4" /><circle cx="15.5" cy="12" r=".6" /><circle cx="17.5" cy="14" r=".6" /></Svg>;
export const ConsoleIcon = (p) => <Svg {...p}><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 13h4M16 12v2M3 5h18" /></Svg>;
export const ShirtIcon = (p) => <Svg {...p}><path d="M8 3l-5 3 2 4 3-1v11h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z" /></Svg>;
export const FigureIcon = (p) => <Svg {...p}><circle cx="12" cy="6" r="3" /><path d="M8 21v-6a4 4 0 0 1 8 0v6M6 21h12" /></Svg>;
export const GiftIcon = (p) => <Svg {...p}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 13h18M12 8c-1-4-6-4-5 0M12 8c1-4 6-4 5 0" /></Svg>;
