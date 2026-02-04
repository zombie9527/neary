import React, { useState, useEffect, useRef } from 'react';
import {
    Download,
    Send,
    Image as ImageIcon,
    File,
    Copy,
    Hash,
    ArrowRight,
    User,
    Activity
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// CONFIG
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const POLL_INTERVAL = 3000;

const App = () => {
    const [roomId, setRoomId] = useState(localStorage.getItem('lastRoomId') || '');
    const [inRoom, setInRoom] = useState(false);
    const [deviceId] = useState(() => localStorage.getItem('deviceId') || 'dev-' + Math.random().toString(36).substr(2, 9));
    const [deviceName, setDeviceName] = useState(() => localStorage.getItem('deviceName') || '设备' + Math.random().toString(36).substr(2, 4));
    const [isEditingName, setIsEditingName] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [hostId, setHostId] = useState(null);
    const [history, setHistory] = useState([]);
    const [inputText, setInputText] = useState('');
    const [toast, setToast] = useState(null); // { message, type }
    const connections = useRef({}); // deviceId -> RTCPeerConnection
    const dataChannels = useRef({}); // deviceId -> RTCDataChannel
    const iceBuffers = useRef({}); // deviceId -> Array of candidates
    const [activePeers, setActivePeers] = useState(0); // For UI indicator
    const [peerNames, setPeerNames] = useState([]); // List of other devices' names
    const peerNamesMap = useRef({}); // deviceId -> name (Host only)

    // File Transfer State (Refs to avoid re-renders during high-freq binary packets)
    const incomingFiles = useRef({}); // fileId -> { name, size, type, chunks: [], receivedSize }
    const CHUNK_SIZE = 16384; // 16KB chunks for stability

    const scrollRef = useRef(null);
    const historyRef = useRef([]); // Ref to keep track of history for Host-sync
    const fileCache = useRef({}); // id -> File object

    useEffect(() => {
        localStorage.setItem('deviceId', deviceId);
        localStorage.setItem('deviceName', deviceName);
        localStorage.setItem('lastRoomId', roomId);
    }, [deviceId, deviceName, roomId]);

    useEffect(() => {
        historyRef.current = history;
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history]);

    // POLL FOR SIGNALS
    useEffect(() => {
        if (!inRoom) return;

        const poll = async () => {
            const isConnected = activePeers > 0;
            if (!isHost && isConnected) return;

            try {
                const res = await fetch(`/api/signals/${roomId}/${deviceId}`);
                const signals = await res.json();
                for (const signal of signals) {
                    await handleIncomingSignal(signal);
                }
            } catch (err) {
                // Reduced noise for transient errors
            }
        };

        // 10s polling for host, guests stop after connection
        const interval = setInterval(poll, 10000);
        poll();
        return () => clearInterval(interval);
    }, [inRoom, roomId, deviceId, isHost, activePeers]);

    const handleIncomingSignal = async (signal) => {
        const { from, type, data } = signal;
        // console.log('Incoming Signal:', type, 'from', from);

        let pc = connections.current[from];
        if (!pc) pc = createPeerConnection(from, false);

        if (type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(from, 'answer', answer);

            if (iceBuffers.current[from]) {
                for (const candidate of iceBuffers.current[from]) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
                delete iceBuffers.current[from];
            }
        } else if (type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            if (iceBuffers.current[from]) {
                for (const candidate of iceBuffers.current[from]) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
                delete iceBuffers.current[from];
            }
        } else if (type === 'ice-candidate') {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data));
                } catch (e) {
                    console.warn('Error adding ice candidate', e);
                }
            } else {
                if (!iceBuffers.current[from]) iceBuffers.current[from] = [];
                iceBuffers.current[from].push(data);
            }
        }
    };

    const createPeerConnection = (remoteId, isInitiator) => {
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(remoteId, 'ice-candidate', event.candidate);
            }
        };

        if (isInitiator) {
            const dc = pc.createDataChannel('chat', { ordered: true });
            setupDataChannel(dc, remoteId);
        } else {
            pc.ondatachannel = (event) => setupDataChannel(event.channel, remoteId);
        }

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                handleChannelClose(remoteId);
            }
        };

        connections.current[remoteId] = pc;
        return pc;
    };

    const setupDataChannel = (dc, remoteId) => {
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 65536;

        dc.onopen = () => {
            dataChannels.current[remoteId] = dc;
            setActivePeers(Object.keys(dataChannels.current).length);

            // Handshake: Send our name to the other side
            dc.send(JSON.stringify({ type: 'JOIN', deviceName }));

            if (isHost) {
                dc.send(JSON.stringify({
                    type: 'SYNC_HISTORY',
                    history: historyRef.current.filter(m => m.type === 'text')
                }));
            }
        };

        dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    handlePeerMessage(msg, remoteId);
                } catch (e) {
                    console.error('Data channel error:', e);
                }
            } else {
                // Handling binary chunk
                handleBinaryChunk(event.data, remoteId);
            }
        };

        dc.onclose = () => handleChannelClose(remoteId);
        dc.onerror = () => handleChannelClose(remoteId);
    };

    const handleChannelClose = (remoteId) => {
        if (dataChannels.current[remoteId]) delete dataChannels.current[remoteId];
        if (connections.current[remoteId]) {
            connections.current[remoteId].close();
            delete connections.current[remoteId];
        }

        if (isHost && peerNamesMap.current[remoteId]) {
            delete peerNamesMap.current[remoteId];
            const updatedNames = Object.values(peerNamesMap.current);
            setPeerNames(updatedNames);
            broadcast({ type: 'PEER_LIST', names: updatedNames });
        }

        setActivePeers(Object.keys(dataChannels.current).length);
    };

    const handlePeerMessage = (msg, from) => {
        if (msg.type === 'SYNC_HISTORY') {
            setHistory(msg.history);
        } else if (msg.type === 'JOIN') {
            if (isHost) {
                peerNamesMap.current[from] = msg.deviceName;
                const updatedNames = Object.values(peerNamesMap.current);
                setPeerNames(updatedNames);
                broadcast({ type: 'PEER_LIST', names: updatedNames });
            }
        } else if (msg.type === 'PEER_LIST') {
            setPeerNames(msg.names);
        } else if (msg.type === 'NEW_MESSAGE') {
            setHistory(prev => {
                // Avoid duplicates
                if (prev.some(m => m.id === msg.data.id)) return prev;
                return [...prev, msg.data];
            });
            if (isHost) {
                // Record text messages in history ref for sync
                if (msg.data.type === 'text') {
                    historyRef.current.push(msg.data);
                }
                broadcast(msg);
            }
        } else if (msg.type === 'FILE_START') {
            incomingFiles.current[msg.fileId] = {
                metadata: msg.metadata,
                chunks: [],
                receivedSize: 0,
                senderDeviceName: msg.deviceName
            };
            // Add a placeholder to history
            const placeholder = {
                id: msg.fileId,
                type: 'text',
                content: `正在从 ${msg.deviceName} 接收文件: ${msg.metadata.name}...`,
                deviceName: '系统',
                timestamp: new Date().toISOString(),
                isPlaceholder: true
            };
            setHistory(prev => [...prev, placeholder]);
            if (isHost) broadcast(msg); // Relay to others
        } else if (msg.type === 'FILE_END') {
            const fileData = incomingFiles.current[msg.fileId];
            if (fileData) {
                const blob = new Blob(fileData.chunks, { type: fileData.metadata.type });
                const url = URL.createObjectURL(blob);
                const finalMsg = {
                    id: msg.fileId,
                    type: 'file',
                    content: url,
                    originalName: fileData.metadata.name,
                    mimetype: fileData.metadata.type,
                    deviceName: fileData.senderDeviceName,
                    timestamp: new Date().toISOString()
                };
                setHistory(prev => prev.filter(m => m.id !== msg.fileId).concat(finalMsg));
                delete incomingFiles.current[msg.fileId];
                if (isHost) broadcast(msg); // Relay to others
            }
        }
    };

    const handleBinaryChunk = (chunk, from) => {
        // Relay logic for host
        if (isHost) {
            Object.keys(dataChannels.current).forEach(id => {
                if (id !== from && dataChannels.current[id].readyState === 'open') {
                    dataChannels.current[id].send(chunk);
                }
            });
        }

        // We assume only one file can be sent at a time from a specific peer for simplicity
        // In a real app, chunks would have headers or be sent on separate channels
        // Actually, we should just use the most recent FILE_START from that peer
        const fileId = Object.keys(incomingFiles.current).pop();
        if (fileId && incomingFiles.current[fileId]) {
            incomingFiles.current[fileId].chunks.push(chunk);
            incomingFiles.current[fileId].receivedSize += chunk.byteLength;
        }
    };

    const sendSignal = async (to, type, data) => {
        try {
            await fetch(`/api/signal/${roomId}/${to}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: deviceId, type, data }),
            });
        } catch (e) { }
    };

    const broadcast = (msg) => {
        Object.values(dataChannels.current).forEach(dc => {
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify(msg));
            }
        });
    };

    const handleJoinRoom = async () => {
        if (!/^\d{3}$/.test(roomId)) return alert('请输入3位数字');

        // Cleanup
        Object.keys(connections.current).forEach(id => {
            try { connections.current[id].close(); } catch (e) { }
            delete connections.current[id];
        });
        Object.keys(dataChannels.current).forEach(id => delete dataChannels.current[id]);
        iceBuffers.current = {};
        peerNamesMap.current = {};
        setPeerNames([]);
        setActivePeers(0);

        try {
            const res = await fetch(`/api/join/${roomId}/${deviceId}`);
            const info = await res.json();
            setIsHost(info.isHost);
            setHostId(info.hostId);
            setInRoom(true);

            if (!info.isHost) {
                const pc = createPeerConnection(info.hostId, true);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendSignal(info.hostId, 'offer', offer);
            }
        } catch (err) {
            alert('无法连接到信令服务器');
        }
    };

    const handleSendText = () => {
        if (!inputText.trim()) return;
        const msgData = {
            id: Date.now() + Math.random(),
            type: 'text',
            content: inputText,
            deviceName,
            timestamp: new Date().toISOString()
        };

        const packet = { type: 'NEW_MESSAGE', data: msgData };

        if (isHost) {
            setHistory(prev => [...prev, msgData]);
            broadcast(packet);
        } else {
            const hostDc = dataChannels.current[hostId];
            if (hostDc?.readyState === 'open') {
                hostDc.send(JSON.stringify(packet));
            } else {
                alert('连接已中断，请尝试刷新页面');
            }
        }
        setInputText('');
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        const metadata = { name: file.name, size: file.size, type: file.type };

        const targetDc = isHost ? Object.values(dataChannels.current) : [dataChannels.current[hostId]];

        const sendToStream = async (dc) => {
            if (!dc || dc.readyState !== 'open') return;

            // Start Notification
            dc.send(JSON.stringify({ type: 'FILE_START', fileId, metadata, deviceName }));

            let offset = 0;
            const reader = new FileReader();

            const readNext = () => {
                if (offset >= file.size) {
                    dc.send(JSON.stringify({ type: 'FILE_END', fileId }));
                    // If host, update local history too
                    if (isHost) {
                        const url = URL.createObjectURL(file);
                        const msgData = {
                            id: fileId,
                            type: 'file',
                            content: url,
                            originalName: file.name,
                            mimetype: file.type,
                            deviceName,
                            timestamp: new Date().toISOString()
                        };
                        setHistory(prev => [...prev, msgData]);
                    }
                    return;
                }

                if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
                    dc.onbufferedamountlow = () => {
                        dc.onbufferedamountlow = null;
                        readNext();
                    };
                    return;
                }

                const slice = file.slice(offset, offset + CHUNK_SIZE);
                reader.onload = (event) => {
                    dc.send(event.target.result);
                    offset += CHUNK_SIZE;
                    readNext();
                };
                reader.readAsArrayBuffer(slice);
            };

            readNext();
        };

        if (isHost) {
            targetDc.forEach(sendToStream);
            // Local update for host
            const url = URL.createObjectURL(file);
            setHistory(prev => [...prev, {
                id: fileId,
                type: 'file',
                content: url,
                originalName: file.name,
                mimetype: file.type,
                deviceName,
                timestamp: new Date().toISOString()
            }]);
        } else {
            sendToStream(targetDc[0]);
        }
    };

    const showToast = (message) => {
        setToast(message);
        setTimeout(() => setToast(null), 2000);
    };

    const copyToClipboard = (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('已复制到剪贴板');
            }).catch(err => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    };

    const fallbackCopy = (text) => {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) showToast('已复制到剪贴板');
        } catch (err) {
            console.error('Fallback copy fail', err);
        }
    };

    if (!inRoom) {
        return (
            <div className="app-container" style={{ justifyContent: 'center', height: '100vh', padding: '1rem' }}>
                <h1 className="title">Neary</h1>
                <div className="glass-card" style={{ padding: '3.5rem 2rem', width: '100%', maxWidth: '400px', textAlign: 'center', background: 'white', margin: '0 auto' }}>
                    <div style={{ background: '#f0f9ff', width: '64px', height: '64px', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
                        <Hash size={32} color="var(--accent-color)" />
                    </div>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '600' }}>输入 3 位房间号建立私密连接</p>
                    <input
                        className="text-input"
                        style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '2rem', fontWeight: '800', letterSpacing: '0.1em', maxWidth: '300px' }}
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="000"
                    />
                    <button className="send-btn" style={{ width: '100%', padding: '1.25rem', justifyContent: 'center', fontSize: '1rem', borderRadius: '0.75rem' }} onClick={handleJoinRoom}>
                        进入房间 <ArrowRight size={20} style={{ marginLeft: '0.5rem' }} />
                    </button>
                    <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>数据保持本地，不经过服务器</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <div style={{ background: 'white', padding: '0.6rem', borderRadius: '0.75rem', boxShadow: 'var(--card-shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Hash size={20} color="var(--accent-color)" />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.02em' }}>房间 {roomId}</h2>
                        {isHost && <span style={{ fontSize: '0.6rem', color: 'var(--success-color)', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>房主 · 主机节点</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div className="glass-card" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', border: '1px solid #f1f5f9', margin: '0 auto' }}>
                        <User size={14} color="var(--text-secondary)" />
                        <input
                            value={deviceName}
                            onChange={e => setDeviceName(e.target.value)}
                            style={{ border: 'none', background: 'transparent', color: 'var(--text-primary)', width: '80px', fontWeight: '700', outline: 'none' }}
                        />
                    </div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: activePeers > 0 ? '#dcfce7' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s ease', position: 'relative' }}>
                        <Activity size={18} color={activePeers > 0 ? '#16a34a' : '#dc2626'} />
                        {peerNames.length > 0 && (
                            <div className="peer-list-dropdown">
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>当前在线：</div>
                                {peerNames.map((name, i) => (
                                    <div key={i} className="peer-chip">{name}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'white', border: 'none' }}>
                <div className="history-container" ref={scrollRef}>
                    {history.length === 0 && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '1.5rem', padding: '4rem 0' }}>
                            <div style={{ background: '#f8fafc', padding: '2rem', borderRadius: '50%' }}>
                                <Send size={48} style={{ opacity: 0.2 }} />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontWeight: '600' }}>建立连接成功</p>
                                <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>发送消息或拖入文件开始分享</p>
                            </div>
                        </div>
                    )}
                    {history.map(msg => (
                        <div key={msg.id} className="message-item">
                            <div className="message-header">
                                <span className="type-badge">{msg.deviceName}</span>
                                <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div className="message-content">
                                {msg.type === 'text' ? (
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {msg.mimetype?.startsWith('image/') ? (
                                            <div className="image-preview-container" onClick={() => window.open(msg.content, '_blank')}>
                                                <img src={msg.content} alt={msg.originalName} />
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'white', borderRadius: '0.75rem', border: '1px solid #f1f5f9' }}>
                                                <div style={{ background: '#f0f9ff', padding: '0.6rem', borderRadius: '0.6rem' }}>
                                                    <File size={24} color="var(--accent-color)" />
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontWeight: '700', fontSize: '0.95rem' }}>{msg.originalName}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{msg.mimetype || '文件'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="action-bar">
                                {msg.type === 'text' ? (
                                    <button className="btn-icon" onClick={() => copyToClipboard(msg.content)}>
                                        <Copy size={14} /> 复制文字
                                    </button>
                                ) : (
                                    <a href={msg.content} download={msg.originalName} className="btn-icon" style={{ textDecoration: 'none' }}>
                                        <Download size={14} /> 下载文件
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="input-area">
                    <div className="input-group">
                        <input
                            className="text-input"
                            placeholder="输入消息..."
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSendText()}
                        />
                        <button className="send-btn" onClick={handleSendText}>
                            <Send size={18} />
                        </button>
                    </div>
                    <div className="file-input-wrapper">
                        <label className="file-label">
                            <ImageIcon size={16} color="var(--accent-color)" />
                            <span>选择图片或文件</span>
                            <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
                        </label>
                    </div>
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <div className="toast-container">
                    <div className="toast-content">
                        {toast}
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
