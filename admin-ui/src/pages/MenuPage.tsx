import MenuPageView from './menu/MenuPageView';
import { useMenuPageController, type MenuPageProps } from './menu/use-menu-page-controller';

export default function MenuPage(props: MenuPageProps) {
  const controller = useMenuPageController(props);
  return <MenuPageView controller={controller} />;
}
