import React, { useMemo } from 'react';
import { Calendar, Clock, Video } from 'lucide-react';

const CalendarView = ({ appointments = [] }) => {
    // Generate the next 7 days starting from today (we show 3-day view for clarity)
    const days = useMemo(() => {
        const arr = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            arr.push(d.toISOString().split('T')[0]);
        }
        return arr;
    }, []);

    // Time slots for VC: 11:00 AM to 7:30 PM (start times for 18 slots)
    const timeSlots = [
        "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
        "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM",
        "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
        "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM",
        "7:00 PM", "7:30 PM"
    ];

    // Group items by date
    const groupedItems = useMemo(() => {
        const groups = {};
        days.forEach(day => groups[day] = []);

        appointments.forEach(appt => {
            if (appt.date && groups[appt.date]) {
                groups[appt.date].push(appt);
            }
        });
        return groups;
    }, [appointments, days]);

    const getDayName = (dateString) => {
        const d = new Date(dateString);
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const getDayNumber = (dateString) => {
        return dateString.split('-')[2];
    };

    const getWhatsAppLink = (appt) => {
        let cleanMobile = (appt.mobile || '').replace(/\D/g, '');
        if (cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(1);
        if (cleanMobile.length === 10) cleanMobile = '91' + cleanMobile;

        const message = `Hi ${appt.firstName}, this is a reminder that your videocall appointment is at ${appt.time}`;
        return `https://wa.me/${cleanMobile}?text=${encodeURIComponent(message)}`;
    };

    return (
        <div className="mt-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <Video className="text-indigo-600 w-6 h-6" />
                        </div>
                        Video Call Appointments
                    </h2>
                    <p className="text-sm text-gray-500 mt-1 font-medium italic">Manage your 30-minute booking slots</p>
                </div>
                <div className="flex flex-col items-end">
                    <div className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] bg-indigo-50 px-3 py-1 rounded-full mb-1">
                        Live Dashboard
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {days.slice(0, 3).map((day) => {
                    const isToday = day === new Date().toISOString().split('T')[0];
                    return (
                        <div key={day} className={`flex flex-col bg-white rounded-2xl shadow-xl border overflow-hidden min-h-[700px] transition-all duration-300 hover:shadow-2xl ${isToday ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-gray-100'}`}>
                            {/* Header */}
                            <div className={`p-5 text-center border-b ${isToday ? 'bg-indigo-600' : 'bg-gray-50'}`}>
                                <div className={`text-xs font-black uppercase tracking-widest ${isToday ? 'text-indigo-100' : 'text-gray-400'}`}>
                                    {getDayName(day)}
                                </div>
                                <div className={`text-4xl font-black mt-1 ${isToday ? 'text-white' : 'text-gray-900'}`}>
                                    {getDayNumber(day)}
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 p-4 space-y-3 overflow-y-auto bg-gray-50/50">
                                {timeSlots.map(time => {
                                    const appt = groupedItems[day].find(o => o.time === time);
                                    return (
                                        <div
                                            key={time}
                                            className={`p-3.5 rounded-xl border transition-all duration-300 ${appt
                                                ? 'bg-white border-indigo-200 shadow-md scale-[1.02]'
                                                : 'bg-white/40 border-gray-100 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 hover:border-gray-300 hover:bg-white'
                                                }`}
                                        >
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-1.5 text-gray-500">
                                                    <Clock size={12} className={appt ? "text-indigo-500" : ""} />
                                                    <span className="text-[11px] font-black tracking-tight">{time}</span>
                                                </div>
                                                {appt && (
                                                    <span className="px-2 py-0.5 text-[9px] font-black text-white bg-indigo-600 rounded-full uppercase tracking-tighter shadow-sm">
                                                        Booked
                                                    </span>
                                                )}
                                            </div>

                                            {appt ? (
                                                <div className="flex flex-col">
                                                    <div className="text-sm font-black text-gray-900 leading-tight">
                                                        {appt.firstName} {appt.lastName}
                                                    </div>
                                                    <div className="text-[11px] text-gray-500 mt-1 font-medium leading-relaxed bg-gray-50 p-2 rounded-lg border border-gray-100 italic">
                                                        "{appt.notes || 'No specific requests'}"
                                                    </div>

                                                    {/* WhatsApp Shortcut */}
                                                    <a
                                                        href={getWhatsAppLink(appt)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="mt-3 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-xl text-[11px] font-black hover:bg-green-600 transition-all shadow-lg shadow-green-100 active:scale-95"
                                                    >
                                                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.394 0 12.029c0 2.119.554 4.187 1.61 6.006L0 24l6.135-1.61a11.83 11.83 0 005.91 1.586h.005c6.636 0 12.032-5.391 12.036-12.028a11.82 11.82 0 00-3.526-8.502z" />
                                                        </svg>
                                                        SEND REMINDER
                                                    </a>
                                                </div>
                                            ) : (
                                                <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest pl-5">Available</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CalendarView;
