import "./App.css";
import { Router } from "./Routes";
import Wrappers from "./wrappers/Wrapper";

function App() {
  return (
    <Wrappers>
      <Router />
    </Wrappers>
  );
}

export default App;
