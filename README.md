# RenderBuddy

Export images and videos from your active Cavalry composition.

**Version:** 0.7.0 · **Cavalry target:** 2.8.0 on macOS

## Features

- Current-frame PNG, WebP and SVG.
- Native MP4, QuickTime ProRes 4444 and WebM.
- PNG sequence → MP4 or WebM through FFmpeg, with optional size and compression variants.
- Save to Downloads or the project's render folder, with an optional subfolder.

## Install

1. Download [`RenderBuddy.js`](https://github.com/markus-zeljak/renderbuddy/releases/latest/download/RenderBuddy.js).
2. In Cavalry, choose **Scripts → Show Scripts Folder**.
3. Copy `RenderBuddy.js` into that folder.
4. Open **Scripts → RenderBuddy**.

To update, replace the file, then close and reopen the panel.

**Scripts** may be under **Window** in some versions; **Show Scripts Folder** may also appear under **Help**. See [Cavalry's installation guide](https://cavalry.studio/docs/tech-info/scripting/script-uis/).

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
| Delete PNG sequence when done | Remove temporary frames after successful encoding |

## Notes

- **macOS only:** this version uses macOS shell commands and needs a port for Windows.
- **Existing outputs are overwritten without confirmation.** Each PNG → Video export clears matching numbered frames in its sequence folder. Wait for encoding to finish before exporting the same composition again.
- Native MP4 and PNG → MP4 share the same output filename.
- PNG → Video uses BT.709 tags and YUV 4:2:0, with no audio or transparency. Player and display color handling can vary.
- With cleanup off, frames stay in `<output>/<Composition>/`. PNG → MP4 uses the output folder; PNG → WebM uses `Web/`. Variants use `Sizes/`, `Compressed/` and `Sizes/Compressed/`.
- If encoding fails, check the composition's `.encode.log` in the system temp folder's `RenderBuddy` directory. Frames may remain after a failed encode.
- Repository preparation checked JavaScript syntax; it did not execute the script inside Cavalry.

### FFmpeg setup

**Only PNG → Video needs FFmpeg.** Images and native Video work without it. No Node.js installation is needed.

1. Install [Homebrew](https://brew.sh/) if needed, then run `brew install ffmpeg` in Terminal. Other builds are linked from [FFmpeg's download page](https://ffmpeg.org/download.html). The build must include `libx264` and `libvpx-vp9`.
2. Close and reopen RenderBuddy. It checks `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `~/bin/ffmpeg` and `~/.local/bin/ffmpeg`.

If it is still not found:

1. Run `which ffmpeg` in Terminal.
2. Open your installed `RenderBuddy.js` in a text editor.
3. Find `function findFFmpeg()` and add your path as the first entry in `var candidates`:

   ```js
   var candidates = [
       "/Users/yourname/Tools/ffmpeg",
       "/opt/homebrew/bin/ffmpeg",
       // Keep the remaining existing entries.
   ];
   ```

4. Save the file, then close and reopen the panel.

> [!TIP]
> Use the full path to the FFmpeg executable, not its folder.

Use forward slashes (`/`). This version checks only the listed paths, not the system `PATH`. Reapply your custom entry after an update.

## Credits

I did not write any of the code. All code was generated with OpenAI Codex from my prompts and feedback.

## Feedback

Found a problem? [Open an issue](https://github.com/markus-zeljak/renderbuddy/issues/new?template=bug_report.yml) with your tool version, Cavalry version, operating system and steps to reproduce.

## License

[MIT](LICENSE). Free to use, modify and share.
