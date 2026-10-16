# RenderBuddy

Quick image and video exports from your active Cavalry composition.

**Version:** 0.7.0 · **Target:** Cavalry 2.8.0 on macOS

## Features

- **Images:** current-frame PNG, WebP and SVG.
- **Video:** native MP4, QuickTime ProRes 4444 and WebM.
- **PNG → Video:** render the playback range to PNG, then encode MP4 or WebM with FFmpeg.
- **Variants:** optional additional width and compressed versions for PNG → Video.
- **Destination:** Downloads or the project's render folder, with an optional subfolder.

## Install

1. Download [RenderBuddy.js](https://github.com/markus-zeljak/renderbuddy/releases/latest/download/RenderBuddy.js) or the [ZIP package](https://github.com/markus-zeljak/renderbuddy/releases/latest/download/RenderBuddy-v0.7.0.zip) and extract it.
2. In Cavalry, choose **Help > Show Scripts Folder** or **Scripts > Show Scripts Folder**.
3. Copy `RenderBuddy.js` into that folder.
4. Open **Scripts > RenderBuddy**. Some versions place this under **Window > Scripts**.

To update, replace the file, then close and reopen its panel. See [Cavalry's script installation guide](https://cavalry.studio/docs/tech-info/scripting/script-uis/).

**Windows:** this release uses macOS shell commands. It needs a Windows port before use on Windows.

## FFmpeg setup — PNG → Video only

**Images and native Video buttons work without FFmpeg.** The **PNG → Video** buttons need a separate FFmpeg installation with `libx264` and `libvpx-vp9` encoders. FFmpeg is not included. No Node.js installation is needed.

1. Install [Homebrew](https://brew.sh/) if needed, then run [its FFmpeg install command](https://formulae.brew.sh/formula/ffmpeg) in Terminal:

   ```sh
   brew install ffmpeg
   ```

2. Close and reopen RenderBuddy. It checks these locations:

   - `/opt/homebrew/bin/ffmpeg`
   - `/usr/local/bin/ffmpeg`
   - `~/bin/ffmpeg`
   - `~/.local/bin/ffmpeg`

### Custom FFmpeg path

If FFmpeg is still not found:

1. Run `which ffmpeg` in Terminal to find the executable's full path. Other compiled downloads are linked from [FFmpeg's official download page](https://ffmpeg.org/download.html).
2. Open your installed `RenderBuddy.js` in a text editor. Find `function findFFmpeg()` and its `var candidates` list.
3. Add your executable's **full path** as the first entry, keeping the quotes and comma. For example:

   ```js
   var candidates = [
       "/Users/yourname/Tools/ffmpeg",
       "/opt/homebrew/bin/ffmpeg",
       // Keep the remaining existing entries.
   ];
   ```

4. Save the file, then close and reopen its panel.

Use forward slashes (`/`) and point to the executable itself, not its folder or download archive. This release checks only the listed paths; it does not search the system `PATH`. Reapply your custom entry after replacing the script with an update.

## Use

1. Open the composition you want to export.
2. Choose the destination and optional subfolder.
3. Move to the desired frame for images, or set the playback range for video.
4. Click a format under **Images**, **Video** or **PNG → Video**.

Native video uses the composition's resolution. PNG → Video encodes in the background and reveals the completed video in Finder.

| PNG → Video control | Effect |
| --- | --- |
| Resolution scale | Slider: 25–200%. Numeric entry: 25% minimum, no upper limit |
| Additional size | Also create a video at the selected width, 240–2560 px |
| Compressed | Also create a video at CRF 18–40; higher means lower quality and usually a smaller file |
| Delete PNG sequence when done | Render frames in the system temp folder and remove them after successful encoding |

**Existing outputs are overwritten without a confirmation.** Each PNG → Video export clears matching numbered frames in its sequence folder. Wait for encoding to finish before exporting the same composition again. Native MP4 and PNG → MP4 share the same output filename.

With cleanup off, frames stay in `<output>/<Composition>/`. PNG → MP4 goes into the output folder; PNG → WebM goes into `Web/`. Optional variants use `Sizes/`, `Compressed/` and `Sizes/Compressed/` inside the relevant video folder.

## Notes and troubleshooting

- PNG → Video uses BT.709 tags and YUV 4:2:0. Player and display color handling can vary. These videos have no audio or transparency.
- Native export behavior follows Cavalry's exporters.
- If encoding fails, check the composition's `.encode.log` in the system temp folder's `RenderBuddy` directory. Frames may remain after a failed encode.
- Packaging checks covered JavaScript syntax only. This release was not executed in Cavalry during repository preparation.

## Authorship

I did not write any of the code. All code was generated with OpenAI Codex from my prompts and feedback.

## Bugs and contributions

[Report a bug](https://github.com/markus-zeljak/renderbuddy/issues/new?template=bug_report.yml) with your Cavalry version, macOS version, settings and relevant error or encode log. Fixes and improvements are welcome.
