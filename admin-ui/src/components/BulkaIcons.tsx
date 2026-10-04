import { forwardRef, type SVGProps } from 'react';

export type BulkaIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};
export type BulkaIconComponent = ReturnType<typeof createBulkaIcon>;

const sprite = '/admin/assets/brand/bulka-icons.svg?v=bulka-premium-1';

/** Bulka's own rounded vector family. Geometry lives in the shared brand sprite. */
function createBulkaIcon(name: string) {
  const Icon = forwardRef<SVGSVGElement, BulkaIconProps>(function BulkaIcon(
    {
      size = 24,
      color = 'currentColor',
      strokeWidth = 1.75,
      absoluteStrokeWidth = false,
      children,
      ...props
    },
    ref,
  ) {
    const weight =
      absoluteStrokeWidth && Number(size) > 0 ? (strokeWidth * 24) / Number(size) : strokeWidth;
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        <use href={`${sprite}#${name}`} />
        {children}
      </svg>
    );
  });
  Icon.displayName = `Bulka${name}`;
  return Icon;
}

export const Activity = createBulkaIcon('Activity');
export const AlertCircle = createBulkaIcon('AlertCircle');
export const AlertTriangle = createBulkaIcon('AlertTriangle');
export const Archive = createBulkaIcon('Archive');
export const ArrowDown = createBulkaIcon('ArrowDown');
export const ArrowDownRight = createBulkaIcon('ArrowDownRight');
export const ArrowDownUp = createBulkaIcon('ArrowDownUp');
export const ArrowLeft = createBulkaIcon('ArrowLeft');
export const ArrowRight = createBulkaIcon('ArrowRight');
export const ArrowUp = createBulkaIcon('ArrowUp');
export const ArrowUpRight = createBulkaIcon('ArrowUpRight');
export const AtSign = createBulkaIcon('AtSign');
export const BadgeCheck = createBulkaIcon('BadgeCheck');
export const BarChart3 = createBulkaIcon('BarChart3');
export const Bell = createBulkaIcon('Bell');
export const BellRing = createBulkaIcon('BellRing');
export const Bike = createBulkaIcon('Bike');
export const Blend = createBulkaIcon('Blend');
export const BookOpenText = createBulkaIcon('BookOpenText');
export const BookmarkPlus = createBulkaIcon('BookmarkPlus');
export const Bot = createBulkaIcon('Bot');
export const Building2 = createBulkaIcon('Building2');
export const Calculator = createBulkaIcon('Calculator');
export const CalendarDays = createBulkaIcon('CalendarDays');
export const CalendarRange = createBulkaIcon('CalendarRange');
export const Camera = createBulkaIcon('Camera');
export const ChartNoAxesCombined = createBulkaIcon('ChartNoAxesCombined');
export const Check = createBulkaIcon('Check');
export const CheckCheck = createBulkaIcon('CheckCheck');
export const CheckCircle2 = createBulkaIcon('CheckCircle2');
export const ChefHat = createBulkaIcon('ChefHat');
export const ChevronDown = createBulkaIcon('ChevronDown');
export const ChevronLeft = createBulkaIcon('ChevronLeft');
export const ChevronRight = createBulkaIcon('ChevronRight');
export const CircleAlert = createBulkaIcon('CircleAlert');
export const CircleDollarSign = createBulkaIcon('CircleDollarSign');
export const CircleHelp = createBulkaIcon('CircleHelp');
export const CircleOff = createBulkaIcon('CircleOff');
export const ClipboardCheck = createBulkaIcon('ClipboardCheck');
export const ClipboardList = createBulkaIcon('ClipboardList');
export const ClipboardMinus = createBulkaIcon('ClipboardMinus');
export const Clock = createBulkaIcon('Clock');
export const Clock3 = createBulkaIcon('Clock3');
export const Cloud = createBulkaIcon('Cloud');
export const Coins = createBulkaIcon('Coins');
export const Columns3 = createBulkaIcon('Columns3');
export const ContactRound = createBulkaIcon('ContactRound');
export const Copy = createBulkaIcon('Copy');
export const Cpu = createBulkaIcon('Cpu');
export const CreditCard = createBulkaIcon('CreditCard');
export const Download = createBulkaIcon('Download');
export const ExternalLink = createBulkaIcon('ExternalLink');
export const Eye = createBulkaIcon('Eye');
export const EyeOff = createBulkaIcon('EyeOff');
export const FileText = createBulkaIcon('FileText');
export const Gift = createBulkaIcon('Gift');
export const Globe2 = createBulkaIcon('Globe2');
export const GripVertical = createBulkaIcon('GripVertical');
export const Handshake = createBulkaIcon('Handshake');
export const Heading = createBulkaIcon('Heading');
export const Headphones = createBulkaIcon('Headphones');
export const History = createBulkaIcon('History');
export const Image = createBulkaIcon('Image');
export const Images = createBulkaIcon('Images');
export const Inbox = createBulkaIcon('Inbox');
export const Info = createBulkaIcon('Info');
export const KeyRound = createBulkaIcon('KeyRound');
export const Languages = createBulkaIcon('Languages');
export const LayoutDashboard = createBulkaIcon('LayoutDashboard');
export const Link2 = createBulkaIcon('Link2');
export const LoaderCircle = createBulkaIcon('LoaderCircle');
export const LockKeyhole = createBulkaIcon('LockKeyhole');
export const LogOut = createBulkaIcon('LogOut');
export const Mail = createBulkaIcon('Mail');
export const MapPin = createBulkaIcon('MapPin');
export const MemoryStick = createBulkaIcon('MemoryStick');
export const Menu = createBulkaIcon('Menu');
export const MessageCircle = createBulkaIcon('MessageCircle');
export const MessageSquareText = createBulkaIcon('MessageSquareText');
export const MessagesSquare = createBulkaIcon('MessagesSquare');
export const Mic = createBulkaIcon('Mic');
export const Monitor = createBulkaIcon('Monitor');
export const MonitorSmartphone = createBulkaIcon('MonitorSmartphone');
export const Navigation = createBulkaIcon('Navigation');
export const Network = createBulkaIcon('Network');
export const Package = createBulkaIcon('Package');
export const PackageCheck = createBulkaIcon('PackageCheck');
export const PackagePlus = createBulkaIcon('PackagePlus');
export const PackageSearch = createBulkaIcon('PackageSearch');
export const PackageX = createBulkaIcon('PackageX');
export const Palette = createBulkaIcon('Palette');
export const PanelLeftClose = createBulkaIcon('PanelLeftClose');
export const Pencil = createBulkaIcon('Pencil');
export const Phone = createBulkaIcon('Phone');
export const Plus = createBulkaIcon('Plus');
export const Power = createBulkaIcon('Power');
export const Printer = createBulkaIcon('Printer');
export const QrCode = createBulkaIcon('QrCode');
export const Receipt = createBulkaIcon('Receipt');
export const ReceiptText = createBulkaIcon('ReceiptText');
export const RefreshCw = createBulkaIcon('RefreshCw');
export const RotateCcw = createBulkaIcon('RotateCcw');
export const RotateCw = createBulkaIcon('RotateCw');
export const Route = createBulkaIcon('Route');
export const Save = createBulkaIcon('Save');
export const Search = createBulkaIcon('Search');
export const Send = createBulkaIcon('Send');
export const ServerCog = createBulkaIcon('ServerCog');
export const Settings2 = createBulkaIcon('Settings2');
export const ShieldAlert = createBulkaIcon('ShieldAlert');
export const ShieldCheck = createBulkaIcon('ShieldCheck');
export const ShieldX = createBulkaIcon('ShieldX');
export const ShoppingBag = createBulkaIcon('ShoppingBag');
export const SlidersHorizontal = createBulkaIcon('SlidersHorizontal');
export const Smartphone = createBulkaIcon('Smartphone');
export const Sparkles = createBulkaIcon('Sparkles');
export const Square = createBulkaIcon('Square');
export const Star = createBulkaIcon('Star');
export const Store = createBulkaIcon('Store');
export const Table2 = createBulkaIcon('Table2');
export const Tablet = createBulkaIcon('Tablet');
export const Tag = createBulkaIcon('Tag');
export const Trash2 = createBulkaIcon('Trash2');
export const Trophy = createBulkaIcon('Trophy');
export const Truck = createBulkaIcon('Truck');
export const Undo2 = createBulkaIcon('Undo2');
export const Upload = createBulkaIcon('Upload');
export const UserCheck = createBulkaIcon('UserCheck');
export const UserCog = createBulkaIcon('UserCog');
export const UserRound = createBulkaIcon('UserRound');
export const UserRoundCog = createBulkaIcon('UserRoundCog');
export const Users = createBulkaIcon('Users');
export const UtensilsCrossed = createBulkaIcon('UtensilsCrossed');
export const Volume2 = createBulkaIcon('Volume2');
export const VolumeX = createBulkaIcon('VolumeX');
export const Wallet = createBulkaIcon('Wallet');
export const Warehouse = createBulkaIcon('Warehouse');
export const Webhook = createBulkaIcon('Webhook');
export const Wifi = createBulkaIcon('Wifi');
export const WifiOff = createBulkaIcon('WifiOff');
export const Workflow = createBulkaIcon('Workflow');
export const X = createBulkaIcon('X');
export const XCircle = createBulkaIcon('XCircle');
export const Zap = createBulkaIcon('Zap');
