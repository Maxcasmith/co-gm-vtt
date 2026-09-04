import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMenuContext } from "../Menu";
import "./MenuItem.css";

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  action: string;
  navigateTo?: string;
  children?: ReactNode;
}

export function MenuItem(props: MenuItemProps) {
  const nav = useNavigate();
  const menuContext = useMenuContext();
  const { icon, label, navigateTo, action = "", children } = props;

  const handleClick = () => {
    try {
      if (!menuContext) throw "No Menu Context supplied";

      const path =
        menuContext.menuAction === `${menuContext.getFullPath()}.${action}`
          ? menuContext.getFullPath()
          : menuContext.getFullPath() + "." + action;

      menuContext.setMenuAction(path);

      if (navigateTo) nav(navigateTo);
    } catch (err) {
      console.error(err);
      return;
    }
  };

  const cls = () => {
    const classList = ["menu--item--wrapper"];

    if (
      menuContext &&
      menuContext.menuAction === `${menuContext.getFullPath()}.${action}`
    )
      classList.push("menu--item--active");

    return classList.join(" ");
  };

  const className = cls();

  return (
    <>
      <div className={className} onClick={handleClick}>
        {icon}
        <strong>{label}</strong>
      </div>
      {menuContext &&
        menuContext.menuAction === `${menuContext.getFullPath()}.${action}` && (
          <div className="menu--item--submenu--container">{children}</div>
        )}
    </>
  );
}
