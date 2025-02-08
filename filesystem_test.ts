import { getFileSafeName } from "./filesystem.ts"
import { assertEquals } from '@std/assert/equals'

Deno.test(function testReplaceFileChars() {
    const name = 'folder:name/with\\invalid*chars?"here<and>here|'
    const safeName = getFileSafeName(name)

    assertEquals(safeName, 'folder-name-with-invalid-chars--here-and-here-')
})
