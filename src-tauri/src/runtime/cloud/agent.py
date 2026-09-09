"""Ephemeral Linux connector, executed over pinned SSH. No install or elevated access.

stdout is exclusively bounded JSON RPC. Listeners bind loopback only. Ending SSH
removes the connector and its terminals; it never powers off the server.
"""
import base64, concurrent.futures, fcntl, http.server, ipaddress, json, os, pty
import select, signal, socket, struct, subprocess, sys, termios, threading, time, uuid

MAX = 1024 * 1024
out_lock = threading.Lock()
lock = threading.RLock()
terminals, streams, waiters = {}, {}, {}
commands = {}
closing = threading.Event()
pool = concurrent.futures.ThreadPoolExecutor(max_workers=12)
slots = threading.BoundedSemaphore(32)

def emit(value):
    with out_lock:
        sys.stdout.write(json.dumps(value, separators=(',', ':')) + '\n')
        sys.stdout.flush()

def decode(value, limit=MAX):
    if not isinstance(value, str) or len(value) > limit * 2:
        raise ValueError('Payload too large')
    data = base64.b64decode(value, validate=True)
    if len(data) > limit: raise ValueError('Payload too large')
    return data

def encode(data): return base64.b64encode(data).decode('ascii')

def host_request(kind, **data):
    ident = 'remote-' + uuid.uuid4().hex
    done = threading.Event()
    with lock: waiters[ident] = [done, None]
    try:
        emit(dict(event=kind, requestId=ident, **data))
        if not done.wait(20): raise TimeoutError('Yougori connection timed out')
        with lock: reply = waiters[ident][1]
        if reply.get('error'): raise ValueError(reply['error'])
        return reply.get('result')
    finally:
        with lock: waiters.pop(ident, None)

def pump(ident, sock):
    try:
        while True:
            try: data = sock.recv(32768)
            except socket.timeout: continue
            if not data:
                emit(dict(event='eof', streamId=ident))
                return
            emit(dict(event='data', streamId=ident, data=encode(data)))
    except OSError:
        stream_close(ident)
        emit(dict(event='closed', streamId=ident))

def stream_close(ident):
    with lock: sock = streams.pop(ident, None)
    if sock:
        try: sock.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        sock.close()
        slots.release()

def stream_start(ident, sock):
    if not isinstance(ident, str) or not ident or len(ident) > 128:
        sock.close()
        raise ValueError('Invalid stream ID')
    if not slots.acquire(False):
        sock.close()
        raise ValueError('Too many connections')
    try:
        with lock:
            if ident in streams: raise ValueError('Duplicate stream ID')
            sock.settimeout(10)
            streams[ident] = sock
        threading.Thread(target=pump, args=(ident, sock), daemon=True).start()
    except Exception:
        with lock:
            if streams.get(ident) is sock: streams.pop(ident)
        sock.close()
        slots.release()
        raise

def exact(sock, size):
    data = b''
    while len(data) < size:
        block = sock.recv(size - len(data))
        if not block: raise OSError('Connection closed')
        data += block
    return data

def socks_client(sock):
    try:
        sock.settimeout(20)
        version, count = exact(sock, 2)
        methods = exact(sock, count)
        if version != 5 or 0 not in methods: raise ValueError('SOCKS5 required')
        sock.sendall(b'\x05\x00')
        version, command, reserved, address_type = exact(sock, 4)
        if version != 5 or command != 1 or reserved: raise ValueError('TCP CONNECT only')
        if address_type == 1: address = socket.inet_ntoa(exact(sock, 4))
        elif address_type == 3: address = exact(sock, exact(sock, 1)[0]).decode('ascii')
        else: raise ValueError('IPv4 only')
        port = struct.unpack('!H', exact(sock, 2))[0]
        if ipaddress.ip_address(address) not in ipaddress.ip_network('10.192.0.0/11'):
            raise ValueError('Only connected Yougori nodes are accessible')
        ident = 'remote-' + uuid.uuid4().hex
        host_request('connect', streamId=ident, address=address, port=port)
        sock.sendall(b'\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00')
        sock.settimeout(None)
        stream_start(ident, sock)
        emit(dict(event='ready', streamId=ident))
    except Exception:
        try: sock.sendall(b'\x05\x02\x00\x01\x00\x00\x00\x00\x00\x00')
        except OSError: pass
        sock.close()

def accept_socks(listener):
    while True:
        sock, _ = listener.accept()
        if not slots.acquire(False): sock.close(); continue
        def serve(sock=sock):
            try: socks_client(sock)
            finally: slots.release()
        threading.Thread(target=serve, daemon=True).start()

class Files(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def handle_request(self):
        try:
            expected = '127.0.0.1:' + str(self.server.server_port)
            if self.headers.get('Host') != expected: raise ValueError('Invalid host')
            if self.headers.get('Origin') not in (None, 'http://' + expected):
                raise ValueError('Cross-origin access blocked')
            if self.headers.get('Transfer-Encoding'): raise ValueError('Invalid framing')
            sizes = self.headers.get_all('Content-Length', [])
            if len(sizes) > 1: raise ValueError('Invalid framing')
            size = int(sizes[0]) if sizes else 0
            if size < 0 or size > MAX: raise ValueError('File request too large')
            body = self.rfile.read(size)
            request = (self.command + ' ' + self.path + ' HTTP/1.1\r\nHost: 10.192.0.1:7444\r\n'
                       'X-OpenDock-Files: 1\r\nContent-Length: ' + str(len(body)) + '\r\n\r\n').encode() + body
            reply = decode(host_request('files', data=encode(request)), MAX + 32768)
            self.wfile.write(reply)
            self.close_connection = True
        except Exception as error:
            self.send_error(403, str(error))
    do_GET = handle_request
    do_POST = handle_request

def term_read(ident, term):
    while True:
        with term['io_lock']:
            if term['closed']: break
            fd = term['fd']
        try: ready, _, _ = select.select([fd], [], [], .25)
        except (OSError, ValueError): break
        if not ready: continue
        with term['io_lock']:
            if term['closed']: break
            try: data = os.read(term['fd'], 32768)
            except BlockingIOError: data = None
            except OSError: break
        if data is None: continue
        if not data: break
        with lock:
            if terminals.get(ident) is not term: break
            term['buffer'].extend(data)
            trim = max(0, len(term['buffer']) - 262144)
            if trim:
                del term['buffer'][:trim]
                term['start'] += trim
    term['process'].wait()

def term_write(term, data):
    # A full/stopped PTY must not hold the global connector lock and freeze
    # every other terminal, file request and network stream. Serialize writes
    # per terminal; use nonblocking I/O and report backpressure explicitly.
    if not term['write_lock'].acquire(False):
        raise ValueError('Another terminal write is in progress; wait before retrying')
    sent = 0
    deadline = time.monotonic() + 3
    try:
        while sent < len(data):
            with term['io_lock']:
                if term['closed']: raise ValueError('Terminal closed')
                try: sent += os.write(term['fd'], data[sent:])
                except BlockingIOError: pass
            if sent < len(data):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Terminal input is full (' + str(sent) + ' of ' + str(len(data)) +
                                       ' bytes sent). Let the command read input before sending more.')
                time.sleep(.01)
    finally:
        term['write_lock'].release()

def term_close(term):
    with term['io_lock']:
        if term['closed']: return
        term['closed'] = True
        os.close(term['fd'])
    if term['process'].poll() is None:
        try: os.killpg(term['process'].pid, signal.SIGHUP)
        except ProcessLookupError: pass

def dispatch(path, body):
    if path == 'health':
        return dict(ready=True, platform=sys.platform, socksPort=socks.getsockname()[1], filesPort=files.server_port)
    if path == 'stream/open':
        port = int(body['port'])
        if not 1 <= port <= 65535: raise ValueError('Invalid service port')
        stream_start(body['streamId'], socket.create_connection(('127.0.0.1', port), timeout=10))
        return dict(ok=True)
    if path == 'exec':
        command = body['command']
        if not command or len(command) > 32768: raise ValueError('Invalid command length')
        # Bounded output, even for an accidentally unbounded command.
        with lock:
            if closing.is_set(): raise ValueError('Cloud connector is closing')
            process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            commands[process.pid] = process
        result = bytearray()
        deadline = time.monotonic() + 20
        try:
            while True:
                if time.monotonic() > deadline: raise TimeoutError('Command exceeded 20 seconds; use a terminal for long-running commands')
                ready, _, _ = select.select([process.stdout], [], [], .1)
                if ready:
                    data = os.read(process.stdout.fileno(), 32768)
                    if not data: break
                    result.extend(data)
                    if len(result) > 262144: raise ValueError('Command output exceeded 256 KB; use a terminal')
            return dict(exitCode=process.wait(timeout=1), stdout=result.decode('utf-8', 'replace'), stderr='')
        finally:
            try:
                if process.poll() is None:
                    try: os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    process.wait()
            finally:
                with lock: commands.pop(process.pid, None)
                process.stdout.close()
    if path == '/v1/services/list': return []
    if path.startswith('/v1/terminal/'):
        action = path.rsplit('/', 1)[1]
        ident = body['sessionId']
        if action not in ('create', 'read', 'write', 'resize', 'close'):
            raise ValueError('Unsupported terminal operation')
        if not ident.startswith('term-') or len(ident) > 80: raise ValueError('Invalid terminal')
        with lock:
            if closing.is_set(): raise ValueError('Cloud connector is closing')
            if action == 'create':
                if len(terminals) >= 16 or ident in terminals: raise ValueError('Terminal limit reached or duplicate terminal')
                master, slave = pty.openpty()
                env = dict(os.environ, TERM='xterm-256color', OPENDOCK_SOCKS_PROXY='socks5h://127.0.0.1:' + str(socks.getsockname()[1]),
                           OPENDOCK_SHARED_FILES='http://127.0.0.1:' + str(files.server_port))
                # A fresh helper sets the controlling TTY, then execs the shell.
                # Avoid preexec_fn in this multithreaded process (fork deadlocks).
                shell = os.environ.get('SHELL', '/bin/sh')
                helper = 'import fcntl,os,sys,termios;fcntl.ioctl(0,termios.TIOCSCTTY,0);os.execv(sys.argv[1],[sys.argv[1],"-i"])'
                try:
                    process = subprocess.Popen([sys.executable, '-c', helper, shell], stdin=slave, stdout=slave, stderr=slave,
                                               env=env, start_new_session=True, cwd=os.path.expanduser('~'))
                    os.set_blocking(master, False)
                except Exception:
                    os.close(master)
                    raise
                finally:
                    os.close(slave)
                term = dict(fd=master, process=process, buffer=bytearray(), start=0, closed=False,
                            io_lock=threading.Lock(), write_lock=threading.Lock())
                terminals[ident] = term
                threading.Thread(target=term_read, args=(ident, term), daemon=True).start()
            term = terminals.get(ident)
            if term is None:
                if action == 'close': return dict(ok=True)
                raise ValueError('Terminal closed')
            if action == 'read':
                offset = max(term['start'], min(term['start'] + len(term['buffer']), int(body.get('offset', 0))))
                data = bytes(term['buffer'][offset - term['start']:offset - term['start'] + 32768])
                return dict(data=encode(data), offset=offset + len(data), done=term['process'].poll() is not None)
            if action == 'close':
                terminals.pop(ident)
        if action in ('create', 'resize'):
            rows = max(2, min(250, int(body.get('rows', 24))))
            cols = max(2, min(500, int(body.get('cols', 80))))
            with term['io_lock']:
                if term['closed']: raise ValueError('Terminal closed')
                fcntl.ioctl(term['fd'], termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        if action == 'write': term_write(term, decode(body.get('data', ''), 32768))
        if action == 'close': term_close(term)
        return dict(ok=True)
    raise ValueError('Unsupported cloud operation')

def request(message):
    try: emit(dict(requestId=message['requestId'], result=dispatch(message['path'], message.get('body', {}))))
    except Exception as error: emit(dict(requestId=message['requestId'], error=str(error)))
    finally: request_slots.release()

socks = socket.socket()
socks.bind(('127.0.0.1', 0)); socks.listen(16)
files = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Files)
files.daemon_threads = True
threading.Thread(target=accept_socks, args=(socks,), daemon=True).start()
threading.Thread(target=files.serve_forever, daemon=True).start()
request_slots = threading.BoundedSemaphore(24)
try:
    while True:
        line = sys.stdin.buffer.readline(MAX * 2 + 1)
        if not line: break
        if len(line) > MAX * 2: raise ValueError('Oversized frame')
        message = json.loads(line)
        if 'path' in message:
            if not request_slots.acquire(False):
                emit(dict(requestId=message['requestId'], error='Too many pending operations'))
            else: pool.submit(request, message)
        elif message.get('event') == 'data':
            with lock: sock = streams.get(message['streamId'])
            if sock:
                try: sock.sendall(decode(message['data'], 32768))
                except OSError: stream_close(message['streamId'])
        elif message.get('event') == 'eof':
            with lock: sock = streams.get(message['streamId'])
            if sock:
                try: sock.shutdown(socket.SHUT_WR)
                except OSError: stream_close(message['streamId'])
        elif message.get('event') == 'closed':
            stream_close(message['streamId'])
        else:
            with lock:
                waiter = waiters.get(message.get('requestId'))
                if waiter: waiter[1] = message; waiter[0].set()
finally:
    # os._exit below intentionally bypasses executor shutdown. First stop the
    # commands owned by this connector; otherwise an SSH disconnect leaves
    # in-flight exec children running without their 20-second deadline.
    with lock:
        closing.set()
        active_commands = list(commands.values())
        active_terminals = list(terminals.values())
    for process in active_commands:
        if process.poll() is None:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            try: process.wait(timeout=2)
            except subprocess.TimeoutExpired: pass
    for term in active_terminals:
        try: term_close(term)
        except OSError: pass
    for sock in list(streams.values()): sock.close()
    # Own ephemeral connector only. Never shut down the server or other processes.
    os._exit(0)
