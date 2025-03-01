# grab-videos

This was a learning project using Typescript and Deno.
It was created and tested on a wordpress site that used a CDN for .m3u8 video streams in an iframe.
It will not be updated, as the task is complete and not generic enough for other sites.

## Recommended dependencies

* Deno https://docs.deno.com/runtime/
* Deno VSCode extension https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno
* FFmpeg https://www.ffmpeg.org/

### Env file required properties

Copy the .env.template file to .env and fill in:

* FFmpeg_path - path to ffmpeg.exe including the filename
* Storage_root - base directory in which to save staging files and folders of video files
* login_url - The URL to navigate to that will capture cookies to be authenticated when 
* logged_in_selector - If found, indicates that access should be authorized.
e.g. A profile username element may indicate that the user is logged in.
* cdn_identifier - The partial URL that should be further explored for .m3u8 resources

## Takeaways

### Main scripts composable with import/export

The ability to run separate scripts as the main, and still export that functionality like any other module, allows for iterative composable development.
Consider the tasks in `deno.json`:
* `find-urls`: This was the first task developed to locate the media resource from a base URL.
I started adding more functionality here to download that media, but decided I'd like to let the location process continue while I figured out how to download the components of the .m3u8 stream.
So, I split off the `download-video` task.
* `download-video`: This needed information I had acquired in `find-urls`, but splitting them out, how can I share that info?
We can easily save to JSON and share the expected types with imports and exports.
This task downloads the .ts files, 8 at a time.
* `compose-video`: This needed the same information as `download-video`.
This task calls out to ffmpeg to create a single .mp4 from the .ts files.
* `capture-video`: Now that I had all the working pieces, this task combines them all together.
Since we have a bunch of typescript modules (maybe "modules"? I'm not familiar with real terminology), I don't need to invoke new processes for each composable step.
Instead, we import the pieces as functions and use them.

### Delayed invocation and concurrent actions

I wasn't happy either downloading the .ts streams sequentially nor triggering them all at once in a loop and waiting for their completion.
The process at the end of `download-video.ts` where we create functions in a loop instead of triggering everything, and then holding a number of slots for active actions, was new to me.

<details>
<summary>Pseudocode showing limited concurrent invocations.</summary>

```typescript title="pseudocode"
const downloaders: (() => Promise<void>)[] = []
const downloadCount = downloadSegments.length
let startedCount = 0
    , completedCount = 0

const startTime = Date.now()
for (const segment of downloadSegments) {
    if (alreadyReceived(segment)) {
        console.log(`Skipping ${segment}...`)
        completedCount++
        continue
    }

    downloaders.push((async () => {
        startedCount++
        const completedPercent = (completedCount / downloadCount * 100).toFixed(2)
        Deno.stdout.write(encoder.encode(`\r[${i} / ${urlCount}] Downloading ${startedCount}, ${completedCount} / ${downloadCount}... ${completedPercent}%${' '.repeat(10)}`))
        await completeSegmentFetch(segment)

        completedCount++
        const completedPercent2 = (completedCount / downloadCount * 100).toFixed(2)
        Deno.stdout.write(encoder.encode(`\r[${i} / ${urlCount}] Downloading ${startedCount}, ${completedCount} / ${downloadCount}... ${completedPercent2}%${' '.repeat(10)}`))
    }))
}

// Nothing has happened yet

const executing: Promise<void>[] = []
for (const downloader of downloaders) {
    const selfRemover = downloader() // This triggers the fetch
        .then(() => {
            const index = executing.indexOf(selfRemover)
            executing.splice(index, 1)
        })
    executing.push(selfRemover)
    if (executing.length > 7) {
        // Wait until we've opened a slot
        await Promise.race(executing)
    }
}
// Wait for remaining slots
await Promise.all(executing)
const taken = (Date.now() - startTime) / 1000
console.log(`\r[${i} / ${urlCount}] took ${taken} seconds${' '.repeat(30)}`)
```
</details>

### Callout to ffmpeg with stream handling

Calling out to an external process is straight-forward.
Piping stdin or stdout is fairly straight-forward.
Optionally saving to a file and outputting to the console required manual sending of the received bytes.

<details>
<summary>Optionally tee logs to stdout</summary>

```typescript title="pseudocode"
const reader = stream.getReader()
while (true) {
    const { value, done } = await reader.read()
    if (done) break

    const next = [writer.write(value)]
    if (teeLog) {
        next.push(Deno.stdout.write(value))
    }
    await Promise.all(next)
}
```
</details>
