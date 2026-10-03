package com.seatplanner.app

import com.seatplanner.app.Servers.LinkRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder

class ServersTest {

    @Test
    fun `an address as typed becomes a server`() {
        assertEquals("http://192.168.0.12:3000", Servers.parseLocal("192.168.0.12:3000"))
        assertEquals("http://192.168.0.12:3000", Servers.parseLocal("  192.168.0.12:3000  "))
        assertEquals("http://192.168.0.12:3000", Servers.parseLocal("http://192.168.0.12:3000/"))
    }

    @Test
    fun `the Next js port is assumed when none is given`() {
        assertEquals("http://192.168.0.12:3000", Servers.parseLocal("192.168.0.12"))
        assertEquals("http://localhost:3000", Servers.parseLocal("localhost"))
    }

    @Test
    fun `every private range and localhost is allowed`() {
        assertEquals("http://10.0.0.5:8080", Servers.parseLocal("10.0.0.5:8080"))
        assertEquals("http://172.16.4.2:3000", Servers.parseLocal("172.16.4.2"))
        assertEquals("http://172.31.255.254:3000", Servers.parseLocal("172.31.255.254"))
        assertEquals("http://127.0.0.1:3001", Servers.parseLocal("127.0.0.1:3001"))
        assertEquals("http://localhost:3001", Servers.parseLocal("LOCALHOST:3001"))
        assertEquals("https://192.168.1.2:3443", Servers.parseLocal("https://192.168.1.2:3443"))
    }

    @Test
    fun `anything on the internet is refused`() {
        listOf(
            "example.com",
            "https://seat-planner-sable.vercel.app",
            "8.8.8.8:3000",
            "172.32.0.1",
            "172.15.0.1",
            "192.169.0.1",
            "11.0.0.1",
            "192.168.0.12.evil.com",
            "evil.com#192.168.0.12",
        ).forEach { assertNull(it, Servers.parseLocal(it)) }
    }

    @Test
    fun `only a bare address is accepted`() {
        listOf(
            "",
            "   ",
            null,
            "192.168.0.12:3000/login",
            "http://192.168.0.12:3000?next=/x",
            "http://192.168.0.12:3000#top",
            "http://user@192.168.0.12:3000",
            "ftp://192.168.0.12",
            "javascript:alert(1)",
            "192.168.0.300",
            "192.168.0",
            "192.168.0.12:0",
            "192.168.0.12:99999",
            "192.168.0.12 :3000",
            "http://[::1]:3000",
        ).forEach { assertNull(it.toString(), Servers.parseLocal(it)) }
    }

    @Test
    fun `local hosts`() {
        assertTrue(Servers.isLocalHost("192.168.100.1"))
        assertFalse(Servers.isLocalHost("192.168.1"))
        assertFalse(Servers.isLocalHost("0192.168.1.1"))
        assertFalse(Servers.isLocalHost("a.b.c.d"))
    }

    @Test
    fun `labels drop the scheme`() {
        assertEquals("192.168.0.12:3000", Servers.label("http://192.168.0.12:3000"))
        assertEquals("seat-planner-sable.vercel.app", Servers.label("https://seat-planner-sable.vercel.app/"))
    }

    @Test
    fun `the App Link from the QR code switches`() {
        val link = "${Servers.production}/app/server?url=${encode("http://192.168.0.12:3000")}"
        assertEquals(LinkRequest.Switch("http://192.168.0.12:3000"), Servers.readLink(link))
        assertEquals(
            LinkRequest.Switch("http://192.168.0.12:3000"),
            Servers.readLink("${Servers.production}/app/server/?url=192.168.0.12:3000"),
        )
    }

    @Test
    fun `the custom scheme link switches too`() {
        assertEquals(
            LinkRequest.Switch("http://10.1.2.3:3000"),
            Servers.readLink("seatplanner://server?url=${encode("http://10.1.2.3:3000")}"),
        )
    }

    @Test
    fun `a switch link to another site is refused, and says what it asked for`() {
        val asked = "https://evil.example/login"
        assertEquals(
            LinkRequest.Refused(asked),
            Servers.readLink("${Servers.production}/app/server?url=${encode(asked)}"),
        )
        assertEquals(LinkRequest.Refused(""), Servers.readLink("seatplanner://server"))
    }

    @Test
    fun `other links are not switch links`() {
        assertNull(Servers.readLink("${Servers.production}/dashboard"))
        assertNull(Servers.readLink("https://evil.example/app/server?url=192.168.0.12:3000"))
        assertNull(Servers.readLink("seatplanner://somewhere?url=192.168.0.12:3000"))
        assertNull(Servers.readLink("not a link at all"))
    }

    private fun encode(text: String) = URLEncoder.encode(text, "UTF-8")
}
