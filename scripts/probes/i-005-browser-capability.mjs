import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    const result = await page.evaluate(async () => {
      const video = document.createElement("video");
      const h264CanPlay = video.canPlayType(
        'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      );
      const mp4CanPlay = video.canPlayType("video/mp4");
      const aacCanPlay = video.canPlayType('audio/mp4; codecs="mp4a.40.2"');

      const webCodecsAvailable =
        typeof VideoDecoder !== "undefined" &&
        typeof AudioDecoder !== "undefined";
      const codecSupport = {
        available: webCodecsAvailable,
        supported: null,
        errors: null,
        notes: [],
      };

      if (webCodecsAvailable) {
        try {
          const videoSupport = await VideoDecoder.isConfigSupported({
            codec: "avc1.42E01E",
            codedWidth: 1024,
            codedHeight: 576,
          });
          const audioSupport = await AudioDecoder.isConfigSupported({
            codec: "mp4a.40.2",
            sampleRate: 44100,
            numberOfChannels: 2,
          });
          codecSupport.supported = {
            video: videoSupport,
            audio: audioSupport,
          };
        } catch (error) {
          codecSupport.errors = String(error);
        }
      } else {
        codecSupport.notes.push(
          "VideoDecoder/AudioDecoder constructor missing in this browser context.",
        );
      }

      return {
        userAgent: navigator.userAgent,
        canPlay: {
          mp4: mp4CanPlay,
          h264_aac: h264CanPlay,
          aac: aacCanPlay,
        },
        webCodecs: codecSupport,
      };
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  } catch (err) {
    console.error("ERROR:" + String(err));
    if (browser) await browser.close();
    process.exit(1);
  }
})();
