import { BrowserRouter, Routes, Route } from "react-router-dom";
import { About } from "./pages/About/About";
import { GameListings } from "./pages/GameListings/GameListings";
import { GameSystems } from "./pages/GameSystems/GameSystems";
import { Home } from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { Products } from "./pages/Products/Products";
import { Profile } from "./pages/Profile/Profile";
import { Settings } from "./pages/Settings/Settings";
import { Signup } from "./pages/Signup/Signup";
import { RequireAuth } from "./components/RequireAuth/RequireAuth";

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/">
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="signup" element={<Signup />} />
          <Route path="products" element={<Products />} />
          <Route path="systems" element={<GameSystems />} />
          <Route path="about" element={<About />} />
          <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="profile/my-games" element={<RequireAuth><GameListings /></RequireAuth>} />
          <Route path="profile/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
