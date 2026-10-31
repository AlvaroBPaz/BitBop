import os
import sys
import webview

class StackChanApi:
    def __init__(self):
        self.window = None

    def set_window(self, window):
        self.window = window

    def toggle_on_top(self, on_top: bool):
        if self.window:
            self.window.on_top = on_top

    def close(self):
        if self.window:
            self.window.destroy()

def main():
    api = StackChanApi()
    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pet.html")

    # Calcula posição inicial no canto inferior direito da tela principal
    screens = webview.screens
    x_pos = None
    y_pos = None
    if screens and len(screens) > 0:
        primary = screens[0]
        x_pos = primary.width - 340
        y_pos = primary.height - 490

    window = webview.create_window(
        title="Stack-chan Desktop Pet",
        url=html_path,
        js_api=api,
        width=310,
        height=450,
        x=x_pos,
        y=y_pos,
        frameless=True,
        transparent=True,
        on_top=True,
        easy_drag=False,  # O arrasto é controlado via CSS -webkit-app-region: drag
        shadow=False,
        resizable=False,
        background_color="#FFFFFF"
    )

    api.set_window(window)
    webview.start(gui="edgechromium", debug=False)

if __name__ == "__main__":
    main()
