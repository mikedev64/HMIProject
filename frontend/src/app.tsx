
import { Greet } from "wailjs-bindings";
import { useState } from "preact/hooks";
import { Fragment, h } from "preact";

export function App(props: any) {
        const [resultText, setResultText] = useState("Please enter your name below 👇");
        const [name, setName] = useState("");
        const updateName = (e: any) => setName(e.target.value);
        const updateResultText = (result: string) => setResultText(result);

        function greet() {
                Greet(name).then(updateResultText);
        }

        return (
                <>
                        <h1>Application</h1>
                        <p>{resultText}</p>
                        <input type="text" onChange={updateName} />
                        <button onClick={greet}>Greet</button>
                </>
        );
}
