package com.seatplanner.app

import org.junit.Assert.assertEquals
import org.junit.Test

class TicketFilesTest {

    @Test
    fun `the site's own name is kept`() {
        assertEquals("ticket-SP7K2Q.pdf", TicketFiles.safeName("ticket-SP7K2Q.pdf"))
    }

    @Test
    fun `a name cannot leave the folder`() {
        assertEquals("passwd.pdf", TicketFiles.safeName("../../etc/passwd"))
        assertEquals("evil.pdf", TicketFiles.safeName("..\\..\\evil.pdf"))
        assertEquals("hidden.pdf", TicketFiles.safeName(".hidden"))
    }

    @Test
    fun `odd characters are replaced and pdf is added`() {
        assertEquals("my_tickets__1_.pdf", TicketFiles.safeName("my tickets (1)"))
        assertEquals("tickets.pdf", TicketFiles.safeName(""))
        assertEquals(84, TicketFiles.safeName("a".repeat(200)).length)
    }
}
