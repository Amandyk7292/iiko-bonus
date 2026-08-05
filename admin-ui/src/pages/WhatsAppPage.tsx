import WhatsAppPageView from './whatsapp/WhatsAppPageView';
import {
  useWhatsAppPageController,
  type WhatsAppPageProps,
} from './whatsapp/use-whatsapp-page-controller';

export default function WhatsAppPage(props: WhatsAppPageProps) {
  const controller = useWhatsAppPageController(props);
  return <WhatsAppPageView controller={controller} />;
}
