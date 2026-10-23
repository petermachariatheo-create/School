using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

// School Manager installer.
//
// The download is a single file. This program is the front of it: the
// application files are appended to this executable as a zip archive, and
// the last eight bytes of the file say how long that archive is.
//
// The installer puts the files somewhere sensible, creates the shortcuts a
// user expects to find, and starts the application.

internal static class Installer
{
    private const string ProductName = "School Manager";
    private const string TaskName = "School Manager";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool allUsers = false;
        bool uninstall = false;
        bool startWithWindows = true;

        foreach (string argument in args)
        {
            string value = argument.ToLowerInvariant();
            if (value == "--all-users")
            {
                allUsers = true;
            }
            else if (value == "--uninstall")
            {
                uninstall = true;
            }
            else if (value == "--no-startup")
            {
                startWithWindows = false;
            }
        }

        try
        {
            if (uninstall)
            {
                return Uninstall();
            }
            return Install(allUsers, startWithWindows);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                ProductName + " could not be installed." + Environment.NewLine + Environment.NewLine + error.Message,
                ProductName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    // ------------------------------------------------------------------ layout

    private static string InstallDirectory(bool allUsers)
    {
        if (allUsers)
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            return Path.Combine(programFiles, ProductName);
        }
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(local, "Programs", ProductName);
    }

    private static string DataDirectory(bool allUsers)
    {
        // The data lives beside the application, so that a copy of the folder
        // is a copy of the school.
        return Path.Combine(InstallDirectory(allUsers), "data");
    }

    // ----------------------------------------------------------------- install

    private static int Install(bool allUsers, bool startWithWindows)
    {
        string target = InstallDirectory(allUsers);
        string source = Assembly.GetExecutingAssembly().Location;

        using (ProgressWindow window = new ProgressWindow())
        {
            window.Show();
            window.SetStatus("Preparing...");

            byte[] payload = ReadPayload(source);
            window.SetStatus("Copying files...");

            // An earlier copy may still be running. It has to be stopped
            // before its files can be replaced.
            StopServer(target);

            Directory.CreateDirectory(target);
            Extract(payload, target, delegate(int percent, string name)
            {
                window.SetProgress(percent);
                window.SetStatus("Copying " + name + "...");
            });

            window.SetStatus("Creating shortcuts...");
            File.WriteAllLines(
                Path.Combine(target, "config.txt"),
                new string[] { "port=8080" });

            CreateShortcuts(target, startWithWindows, allUsers);

            window.SetStatus("Creating a certificate for other devices...");
            string certificate = CreateCertificate(target, allUsers);
            if (certificate != null)
            {
                File.AppendAllLines(
                    Path.Combine(target, "config.txt"),
                    new string[] { "tlsPort=8443", "tlsPfx=runtime\\cert\\server.pfx" });            }

            // An earlier attempt may have left a note about something that
            // has since been fixed.
            try
            {
                File.Delete(Path.Combine(target, "install-error.log"));
            }
            catch
            {
                // Nothing to do.
            }

            window.SetProgress(100);
            window.SetStatus("Done.");
            Thread.Sleep(400);
            window.Close();
        }

        // Start the application so the user sees something happen.
        try
        {
            Process.Start(new ProcessStartInfo(Path.Combine(target, ProductName + ".exe")) { UseShellExecute = true });
        }
        catch
        {
            // The shortcuts are there even if this fails.
        }
        return 0;
    }

    /// <summary>
    /// Read the payload that was appended to this executable.
    ///
    /// The last eight bytes hold the length of the zip archive, as a 64-bit
    /// little-endian number. Everything between the end of this program and
    /// those eight bytes is the archive.
    /// </summary>
    private static byte[] ReadPayload(string executable)
    {
        FileStream stream = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            if (stream.Length < 8)
            {
                throw new IOException("This installer is incomplete. Download it again.");
            }
            stream.Seek(-8, SeekOrigin.End);
            byte[] trailer = new byte[8];
            ReadExactly(stream, trailer);
            long length = BitConverter.ToInt64(trailer, 0);
            long offset = stream.Length - 8 - length;
            if (length <= 0 || offset < 0)
            {
                throw new IOException("This installer is incomplete. Download it again.");
            }
            stream.Seek(offset, SeekOrigin.Begin);
            byte[] payload = new byte[length];
            ReadExactly(stream, payload);
            return payload;
        }
        finally
        {
            stream.Close();
        }
    }

    private static void ReadExactly(Stream stream, byte[] buffer)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int read = stream.Read(buffer, offset, buffer.Length - offset);
            if (read <= 0)
            {
                throw new IOException("This installer is incomplete. Download it again.");
            }
            offset += read;
        }
    }

    private static void Extract(byte[] payload, string target, Action<int, string> progress)
    {
        using (MemoryStream memory = new MemoryStream(payload))
        using (ZipArchive archive = new ZipArchive(memory, ZipArchiveMode.Read))
        {
            List<ZipArchiveEntry> entries = new List<ZipArchiveEntry>(archive.Entries);
            long total = 0;
            foreach (ZipArchiveEntry entry in entries)
            {
                total += entry.Length;
            }

            long done = 0;
            int index = 0;
            foreach (ZipArchiveEntry entry in entries)
            {
                index++;
                string name = Path.GetFileName(entry.FullName);
                if (entry.FullName.EndsWith("/"))
                {
                    Directory.CreateDirectory(Path.Combine(target, entry.FullName.TrimEnd('/').Replace('/', Path.DirectorySeparatorChar)));
                    continue;
                }

                string path = Path.Combine(target, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                string directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                using (Stream source = entry.Open())
                using (FileStream output = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    byte[] buffer = new byte[128 * 1024];
                    int read;
                    while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        done += read;
                        if (total > 0)
                        {
                            progress((int)Math.Min(99, (done * 100) / total), name);
                        }
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------- certificate

    /// <summary>
    /// Create the certificate that lets another device run the school
    /// offline.
    ///
    /// A browser only allows an application to be installed, and to work
    /// without a network, when it is served from a secure origin. On a
    /// school's own network that means the server needs a certificate the
    /// device trusts. This one is created here, trusted on this computer
    /// straight away, and saved next to the application so that it can be
    /// given to a phone or a tablet.
    /// </summary>
    private static string CreateCertificate(string target, bool allUsers)
    {
        try
        {
            string certificateDirectory = Path.Combine(target, "runtime", "cert");
            Directory.CreateDirectory(certificateDirectory);
            string pfx = Path.Combine(certificateDirectory, "server.pfx");
            string cer = Path.Combine(certificateDirectory, "school-manager.cer");

            // The names the certificate must be valid for: the addresses a
            // device might use to reach this computer.
            List<string> names = new List<string>();
            names.Add("DNS=localhost");
            foreach (string address in LocalAddresses())
            {
                names.Add("ipaddress=" + address);
            }
            try
            {
                names.Add("DNS=" + Environment.MachineName);
                names.Add("DNS=" + Environment.MachineName + ".local");
            }
            catch
            {
                // The machine name is a convenience, not a requirement.
            }

            string passphrase = MakePassphrase();
            string store = allUsers ? "LocalMachine" : "CurrentUser";
            string quoted = string.Join(
                ",",
                Array.ConvertAll(names.ToArray(), delegate(string name)
                {
                    return "'" + name.Replace("'", "''") + "'";
                }));
            string script =
                "$ErrorActionPreference = 'Stop';" +
                "$names = @(" + quoted + ");" +
                // The extension is built in a variable first: written inline,
                // PowerShell's parameter binder mangles the concatenation.
                "$san = '2.5.29.17={text}' + ($names -join '&');" +
                "$cert = New-SelfSignedCertificate -Subject 'CN=School Manager' " +
                "-CertStoreLocation 'Cert:\\" + store + "\\My' -KeyAlgorithm RSA -KeyLength 2048 " +
                "-HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable " +
                "-TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', $san);" +
                "Export-PfxCertificate -Cert $cert -FilePath '" + pfx.Replace("'", "''") + "' " +
                "-Password (ConvertTo-SecureString '" + passphrase + "' -AsPlainText -Force) | Out-Null;" +
                "Export-Certificate -Cert $cert -FilePath '" + cer.Replace("'", "''") + "' | Out-Null;" +
                "Remove-Item -Path ('Cert:\\" + store + "\\My\\' + $cert.Thumbprint) -Force;";

            RunPowerShell(script);

            // The passphrase is only useful to this computer, and it only
            // protects the file at rest. It is kept beside the file.
            File.WriteAllLines(
                Path.Combine(certificateDirectory, "passphrase.txt"),
                new string[] { passphrase });
            return cer;
        }
        catch (Exception error)
        {
            // Write the reason down: the message box may not be seen, and
            // the person who can fix it will not be the person who clicked.
            try
            {
                File.WriteAllText(
                    Path.Combine(target, "install-error.log"),
                    DateTime.Now.ToString("s") + " the certificate could not be created: " + error.Message + Environment.NewLine + error.StackTrace);
            }
            catch
            {
                // Nothing more can be done.
            }
            MessageBox.Show(
                "The certificate could not be created, so another device will not be able to work offline."
                    + Environment.NewLine + Environment.NewLine + error.Message,
                ProductName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return null;
        }
    }

    private static string[] LocalAddresses()
    {
        List<string> addresses = new List<string>();
        try
        {
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up)
                {
                    continue;
                }
                foreach (UnicastIPAddressInformation address in adapter.GetIPProperties().UnicastAddresses)
                {
                    if (address.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        string text = address.Address.ToString();
                        if (!addresses.Contains(text))
                        {
                            addresses.Add(text);
                        }
                    }
                }
            }
        }
        catch
        {
            // A certificate with only the loopback name is still useful.
        }
        return addresses.ToArray();
    }

    private static string MakePassphrase()
    {
        byte[] bytes = new byte[24];
        using (RandomNumberGenerator random = RandomNumberGenerator.Create())
        {
            random.GetBytes(bytes);
        }
        return Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").Replace("=", "");
    }

    private static void RunPowerShell(string script)
    {
        // The script is written to a file and run from there. Passing it on
        // the command line would mean fighting the quoting rules of two
        // different parsers.
        string path = Path.Combine(Path.GetTempPath(), "school-manager-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            File.WriteAllText(path, script);

            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = "powershell";
            info.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + path + "\"";
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;

            using (Process process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    throw new IOException("PowerShell reported: " + (error == "" ? output : error));
                }
            }
        }
        finally
        {
            try
            {
                File.Delete(path);
            }
            catch
            {
                // A temporary file left behind is not worth failing over.
            }
        }
    }

    // --------------------------------------------------------------- shortcuts

    private static void CreateShortcuts(string target, bool startWithWindows, bool allUsers)
    {
        string executable = Path.Combine(target, ProductName + ".exe");

        CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk"), executable, target);
        CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName + ".lnk"), executable, target);

        if (startWithWindows)
        {
            string startup = allUsers
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), ProductName + ".lnk")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), ProductName + ".lnk");
            CreateShortcut(startup, executable, target, "--background");
        }
    }

    /// <summary>
    /// Create a Windows shortcut.
    ///
    /// The shell is used through late binding so that the program does not
    /// need a reference to the scripting library at compile time.
    /// </summary>
    private static void CreateShortcut(string linkPath, string target, string workingDirectory)
    {
        CreateShortcut(linkPath, target, workingDirectory, null);
    }

    private static void CreateShortcut(string linkPath, string target, string workingDirectory, string arguments)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(linkPath));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                return;
            }
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Open the school management system" });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { target + ",0" });
            if (!string.IsNullOrEmpty(arguments))
            {
                shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
            }
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch
        {
            // A missing shortcut is not worth failing the installation over.
        }
    }

    // ---------------------------------------------------------------- uninstall

    private static int Uninstall()
    {
        bool allUsers = false;
        foreach (string argument in Environment.GetCommandLineArgs())
        {
            if (string.Equals(argument, "--all-users", StringComparison.OrdinalIgnoreCase))
            {
                allUsers = true;
            }
        }

        string target = InstallDirectory(allUsers);

        // Stop the server if it is running.
        StopServer(target);

        DeleteIfPresent(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk"));
        DeleteIfPresent(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName + ".lnk"));
        DeleteIfPresent(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), ProductName + ".lnk"));
        DeleteIfPresent(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), ProductName + ".lnk"));

        try
        {
            if (Directory.Exists(target))
            {
                Directory.Delete(target, true);
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "The application files could not be removed." + Environment.NewLine + Environment.NewLine + error.Message,
                ProductName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return 1;
        }

        return 0;
    }

    private static void StopServer(string target)
    {
        StopProcess("node", Path.Combine(target, "runtime", "node.exe"));
        StopProcess(ProductName, Path.Combine(target, ProductName + ".exe"));
    }

    /// <summary>
    /// Stop a running copy of the application.
    ///
    /// The files cannot be replaced while the program that is using them is
    /// still running, and a failed installation leaves exactly that behind.
    /// </summary>
    private static void StopProcess(string processName, string expectedPath)
    {
        try
        {
            Process[] processes = Process.GetProcessesByName(processName);
            foreach (Process process in processes)
            {
                try
                {
                    string path = process.MainModule.FileName;
                    if (string.Equals(path, expectedPath, StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch
                {
                    // The process may have exited, or may belong to another
                    // user. Either way, there is nothing to do.
                }
            }
        }
        catch
        {
            // Nothing to stop.
        }
    }

    private static void DeleteIfPresent(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Leaving a shortcut behind is not worth failing over.
        }
    }

    // -------------------------------------------------------------------- form

    /// <summary>
    /// A small window that shows what the installer is doing.
    /// </summary>
    private sealed class ProgressWindow : Form
    {
        private readonly Label status = new Label();
        private readonly ProgressBar bar = new ProgressBar();

        public ProgressWindow()
        {
            Text = ProductName;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 130);
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;

            Label title = new Label();
            title.Text = "Installing " + ProductName;
            title.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(20, 18);
            Controls.Add(title);

            status.AutoSize = false;
            status.Size = new Size(400, 20);
            status.Location = new Point(20, 56);
            status.Text = "Preparing...";
            Controls.Add(status);

            bar.Location = new Point(20, 86);
            bar.Size = new Size(400, 22);
            bar.Minimum = 0;
            bar.Maximum = 100;
            Controls.Add(bar);
        }

        public void SetStatus(string text)
        {
            status.Text = text;
            Application.DoEvents();
        }

        public void SetProgress(int percent)
        {
            bar.Value = Math.Max(bar.Minimum, Math.Min(bar.Maximum, percent));
            Application.DoEvents();
        }
    }
}
