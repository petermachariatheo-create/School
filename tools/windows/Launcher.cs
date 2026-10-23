using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// School Manager launcher.
//
// The installed application is a server plus a browser client. This program
// is the only thing a user has to know about: double-click it, and the
// server starts (if it is not already running) and the school opens in the
// default browser.
//
// It is built as a windowed executable, so no console window appears.

internal static class Launcher
{
    private const string ProductName = "School Manager";

    /// <summary>
    /// How long the "is it already running?" check may take.
    ///
    /// This check happens before anything is started, so it has to be quick:
    /// it is the difference between the launcher returning at once and the
    /// user wondering whether the program is working.
    /// </summary>
    private const int QuickTimeoutMs = 400;

    /// <summary>
    /// How long the readiness check may take once a server has been started.
    ///
    /// A server that is busy copying its write-ahead log into the database
    /// file can take a moment to answer. The check is given room, because a
    /// server that is alive and slow must not be mistaken for a server that
    /// is not there — that mistake leaves the user with an error message and
    /// a working application.
    /// </summary>
    private const int HealthTimeoutMs = 2500;

    private const int StartupTimeoutMs = 30000;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--open";

            if (mode == "--background")
            {
                // Started by Windows at sign-in. Start the server, but do not
                // open a browser: nobody is watching.
                EnsureServer(root, false);
                return 0;
            }

            if (mode == "--server-only")
            {
                EnsureServer(root, false);
                return 0;
            }

            int port = EnsureServer(root, true);
            if (port > 0)
            {
                OpenBrowser("http://localhost:" + port + "/");
            }
            return 0;
        }
        catch (Exception error)
        {
            ShowError("School Manager could not start.", error);
            return 1;
        }
    }

    // ------------------------------------------------------------------ server

    /// <summary>
    /// Start the server if it is not already running, and return the port it
    /// is listening on, or 0 if it could not be started.
    /// </summary>
    private static int EnsureServer(string root, bool reportFailure)
    {
        int port = ReadPort(root);
        Trace(root, "starting; configured port " + port);

        if (IsServerUp(port))
        {
            Trace(root, "the server is already running on " + port);
            return port;
        }

        string node = Path.Combine(root, "runtime", "node.exe");
        string server = Path.Combine(root, "runtime", "server", "index.mjs");
        string data = Path.Combine(root, "data");

        if (!File.Exists(node) || !File.Exists(server))
        {
            if (reportFailure)
            {
                ShowError("School Manager is not installed correctly.", new Exception("The server files are missing. Reinstall the application."));
            }
            return 0;
        }

        Directory.CreateDirectory(data);

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = node;
        info.Arguments = "\"" + server + "\"";
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.EnvironmentVariables["SCHOOL_HOST"] = "0.0.0.0";
        info.EnvironmentVariables["SCHOOL_PORT"] = port.ToString();
        info.EnvironmentVariables["SCHOOL_DATA_DIR"] = data;
        info.EnvironmentVariables["SCHOOL_WEB_ROOT"] = Path.Combine(root, "runtime", "web");

        // The server writes its own log file, so that the record of what
        // happened survives this program exiting. There is no console to
        // write to.
        info.EnvironmentVariables["SCHOOL_LOG_FILE"] = Path.Combine(data, "server.log");

        // The server writes down the port it ended up on. Reading it is
        // quicker and far more certain than looking for the server: on a
        // school machine a port that is not in use is not always refused
        // straight away, because the firewall can drop the connection.
        info.EnvironmentVariables["SCHOOL_PORT_FILE"] = PortFile(root);
        info.EnvironmentVariables["SCHOOL_SECURE_PORT_FILE"] = SecurePortFile(root);
        try
        {
            File.Delete(PortFile(root));
            File.Delete(SecurePortFile(root));
        }
        catch
        {
            // A port file that cannot be removed is replaced when the
            // server writes to it.
        }

        ApplyTlsSettings(root, info);

        Process process = new Process();
        process.StartInfo = info;
        Trace(root, "starting the server process");
        process.Start();
        Trace(root, "the server process was started");
        process.Dispose();

        // The server moves to the next port when the one it was given is
        // taken, so every port from the one that was asked for onwards has
        // to be checked.
        int found = WaitForServer(root, port, StartupTimeoutMs);
        Trace(root, "the server answered on port " + found);
        if (found > 0)
        {
            WritePort(root, found);
            return found;
        }

        if (reportFailure)
        {
            Trace(root, "the server did not answer in time");
            ShowError(
                "School Manager could not start.",
                new Exception("The server did not respond within " + (StartupTimeoutMs / 1000) + " seconds. See the server log in the data folder for details."));
        }
        return 0;
    }

    /// <summary>
    /// Record what the launcher is doing.
    ///
    /// The launcher has no console, so a record of what it did is the only
    /// way to find out why it did not work.
    /// </summary>
    private static void Trace(string root, string message)
    {
        try
        {
            string directory = Path.Combine(root, "data");
            Directory.CreateDirectory(directory);
            File.AppendAllText(
                Path.Combine(directory, "launcher.log"),
                DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine);
        }
        catch
        {
            // A log that cannot be written must not stop the application.
        }
    }

    // ------------------------------------------------------------------ health

    /// <summary>
    /// True when the thing on the port is this application.
    ///
    /// Another program may already own the port, and opening the browser to
    /// it would show the wrong thing. The server says who it is, and the
    /// answer is checked.
    /// </summary>
    private static bool IsServerUp(int port)
    {
        return IsServerUp(port, QuickTimeoutMs);
    }

    private static bool IsServerUp(int port, int timeoutMs)
    {
        // A closed port is checked first, because the answer comes back
        // quickly and the request below costs a second when it fails.
        if (!IsPortOpen(port, Math.Min(timeoutMs, 500)))
        {
            return false;
        }

        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/v1/health");
            request.Method = "GET";
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            // A school machine often has a proxy configured for the internet.
            // A request to this computer must not go through it: the proxy
            // would either refuse it or take an age to answer, and the
            // request timeout does not cover the time spent finding the
            // proxy.
            request.Proxy = null;
            request.KeepAlive = false;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    return false;
                }
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    // The answer is JSON, and the marker is a field of it.
                    // Spaces are not part of the marker, so they are taken
                    // out before it is looked for.
                    string compact = RemoveWhitespace(body);
                    return compact.Contains("\"product\":\"school-manager\"");
                }
            }
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Take the spaces out of a JSON answer, so that a field can be looked
    /// for no matter how the answer was written down.
    /// </summary>
    private static string RemoveWhitespace(string text)
    {
        StringBuilder builder = new StringBuilder(text.Length);
        foreach (char character in text)
        {
            if (!char.IsWhiteSpace(character))
            {
                builder.Append(character);
            }
        }
        return builder.ToString();
    }

    /// <summary>
    /// True when something is listening on the port.
    ///
    /// A port that is not in use is not always refused straight away: the
    /// firewall can drop the connection, and then the only answer comes
    /// when the time is up. The check is therefore kept short, and it is
    /// only used to rule a port out.
    /// </summary>
    private static bool IsPortOpen(int port, int timeoutMs)
    {
        try
        {
            TcpClient client = new TcpClient();
            IAsyncResult pending = client.BeginConnect("127.0.0.1", port, null, null);
            if (!pending.AsyncWaitHandle.WaitOne(timeoutMs, false))
            {
                client.Close();
                return false;
            }
            client.EndConnect(pending);
            client.Close();
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// The port the server wrote down, or 0 when it has not written one.
    /// </summary>
    private static int ReadRecordedPort(string file)
    {
        try
        {
            string[] lines = File.ReadAllLines(file);
            foreach (string line in lines)
            {
                int parsed;
                if (int.TryParse(line.Trim(), out parsed) && parsed > 0)
                {
                    return parsed;
                }
            }
        }
        catch
        {
            // The server has not written the file yet.
        }
        return 0;
    }

    /// <summary>
    /// Wait for the server to answer, and return the port it is on.
    ///
    /// The server takes the next port when the one it was given is already
    /// taken, so the port it ended up on is not known in advance. It writes
    /// it down, and that is what is read here. Should the file not appear —
    /// an older server, or one that cannot write to it — the ports it might
    /// have moved to are checked instead, with a short probe, because a
    /// port that is not in use can take seconds to say so.
    /// </summary>
    private static int WaitForServer(string root, int firstPort, int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        DateTime scanAfter = DateTime.UtcNow.AddSeconds(ScanAfterMs);
        bool scanned = false;

        while (DateTime.UtcNow < deadline)
        {
            int recorded = ReadRecordedPort(PortFile(root));
            if (recorded > 0)
            {
                if (IsServerUp(recorded, HealthTimeoutMs))
                {
                    return recorded;
                }

                // The server writes the port down only once it is listening,
                // so a port file naming a port that answers means the server
                // is there. The marker check is a confirmation, not the
                // evidence: a busy server can take longer than the check is
                // willing to wait, and calling that a failure would leave a
                // working application reported as broken.
                if (IsPortOpen(recorded, 1000))
                {
                    Trace(root, "the server is listening on " + recorded + "; the marker check did not answer in time");
                    return recorded;
                }
            }

            if (IsServerUp(firstPort, HealthTimeoutMs))
            {
                return firstPort;
            }

            if (!scanned && DateTime.UtcNow >= scanAfter)
            {
                scanned = true;
                int found = ScanForServer(firstPort);
                if (found > 0)
                {
                    return found;
                }
            }

            Thread.Sleep(200);
        }
        return 0;
    }

    /// <summary>
    /// Look for the server on the ports it might have moved to.
    /// </summary>
    private static int ScanForServer(int firstPort)
    {
        for (int port = firstPort; port < firstPort + PortRange; port++)
        {
            if (IsPortOpen(port, 150) && IsServerUp(port, HealthTimeoutMs))
            {
                return port;
            }
        }
        return 0;
    }

    /// <summary>How many ports the server might have moved to.</summary>
    private const int PortRange = 20;

    /// <summary>How long to wait for the port file before looking for the server instead.</summary>
    private const int ScanAfterMs = 5000;

    /// <summary>The file the server writes the port it ended up on to.</summary>
    private static string PortFile(string root)
    {
        return Path.Combine(root, "data", "server.port");
    }

    /// <summary>The same, for the encrypted listener.</summary>
    private static string SecurePortFile(string root)
    {
        return Path.Combine(root, "data", "server-secure.port");
    }

    // ------------------------------------------------------------------ config

    /// <summary>
    /// Tell the server about the certificate, when there is one.
    ///
    /// The encrypted listener is what lets a phone or a tablet run the
    /// school without a network, so it is worth the trouble.
    /// </summary>
    private static void ApplyTlsSettings(string root, ProcessStartInfo info)
    {
        // The installer writes where the certificate is into the settings
        // file, so that a school administrator can move it. The default is
        // where the installer puts it.
        string configured = ReadSetting(root, "tlsPfx", "runtime\\cert\\server.pfx");
        string pfx = Path.IsPathRooted(configured) ? configured : Path.Combine(root, configured);
        if (!File.Exists(pfx))
        {
            return;
        }

        info.EnvironmentVariables["SCHOOL_TLS_PFX"] = pfx;
        info.EnvironmentVariables["SCHOOL_TLS_PORT"] = ReadSetting(root, "tlsPort", "8443");

        string certificate = Path.Combine(root, "runtime", "cert", "school-manager.cer");
        if (File.Exists(certificate))
        {
            info.EnvironmentVariables["SCHOOL_TLS_CERTIFICATE"] = certificate;
        }

        string passphrasePath = Path.Combine(root, "runtime", "cert", "passphrase.txt");
        if (File.Exists(passphrasePath))
        {
            try
            {
                info.EnvironmentVariables["SCHOOL_TLS_PASSPHRASE"] =
                    File.ReadAllText(passphrasePath).Trim();
            }
            catch
            {
                // Without the passphrase the server will not start the
                // encrypted listener. The plain one still works.
            }
        }
    }

    private static string ConfigPath(string root)
    {
        return Path.Combine(root, "config.txt");
    }

    private static int ReadPort(string root)
    {
        string value = ReadSetting(root, "port", "8080");
        int parsed;
        return int.TryParse(value, out parsed) && parsed > 0 ? parsed : 8080;
    }

    private static string ReadSetting(string root, string key, string fallback)
    {
        try
        {
            string[] lines = File.ReadAllLines(ConfigPath(root));
            foreach (string line in lines)
            {
                if (line.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase))
                {
                    return line.Substring(key.Length + 1).Trim();
                }
            }
        }
        catch
        {
            // No configuration yet: use the default.
        }
        return fallback;
    }

    private static void WritePort(string root, int port)
    {
        try
        {
            List<string> lines = new List<string>();
            lines.Add("port=" + port);
            string[] existing = File.ReadAllLines(ConfigPath(root));
            foreach (string line in existing)
            {
                if (!line.StartsWith("port=", StringComparison.OrdinalIgnoreCase))
                {
                    lines.Add(line);
                }
            }
            File.WriteAllLines(ConfigPath(root), lines.ToArray());
        }
        catch
        {
            // The port is still usable for this session.
        }
    }

    // ------------------------------------------------------------------ browser

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            ShowError("School Manager is running.", new Exception("The browser could not be opened automatically. Open " + url + " by hand."));
        }
    }

    private static void ShowError(string title, Exception error)
    {
        try
        {
            MessageBox.Show(
                title + Environment.NewLine + Environment.NewLine + error.Message,
                ProductName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        catch
        {
            // There is nothing more that can be done.
        }
    }
}
