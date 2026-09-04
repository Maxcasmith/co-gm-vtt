import { createContext, useContext, useState, type ReactNode } from "react";
import "./Menu.css";

interface MenuProps {
  name: string;
  children: ReactNode;
  title?: string;
}

interface MenuContextInterface {
  menuAction: string;
  setMenuAction: (val: string) => void;
  getFullPath: () => string;
}

const MenuContext = createContext<MenuContextInterface | undefined>(undefined);

function Menu(props: MenuProps) {
  const { name, title, children } = props;
  const [menuAction, setMenuAction] = useState<string>("");

  const menuContext = useMenuContext();

  const getFullPath = () => {
    return menuContext ? menuContext.getFullPath() + "." + name : name;
  };

  return (
    <div className="menu--wrapper">
      {title && <strong className="menu--title">{title}</strong>}
      <MenuContext.Provider value={{ menuAction, setMenuAction, getFullPath }}>
        {children}
      </MenuContext.Provider>
    </div>
  );
}

function useMenuContext() {
  return useContext(MenuContext);
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider
export { Menu, useMenuContext };
