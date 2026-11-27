import os
import firebase_admin
import hmac
from zoneinfo import ZoneInfo
from firebase_admin import credentials, firestore
from flask import Flask, jsonify, request
from dotenv import load_dotenv
from flask_cors import CORS
from datetime import datetime

load_dotenv()

app = Flask(__name__)
CORS(app)

# Conectar ao Firebase
caminho_chave = os.getenv("FIREBASE_CREDENTIALS")

credencial = credentials.Certificate(caminho_chave)

firebase_admin.initialize_app(credencial)

db = firestore.client()

@app.route("/", methods=["GET"])
def inicio():
    return jsonify({
        "mensagem": "Backend do SmartPark funcionando!"
    })


# Listar estacionamentos
@app.route("/api/estacionamentos", methods=["GET"])
def listar_estacionamentos():

    consulta = db.collection("estacionamentos").stream()

    estacionamentos = []

    for documento in consulta:
        dados = documento.to_dict()
        dados["id"] = documento.id
        estacionamentos.append(dados)

    return jsonify(estacionamentos)


# Criar reserva
@app.route("/api/reservas", methods=["POST"])
def criar_reserva():

    dados = request.get_json(silent=True) or {}

    estacionamento_id = dados.get("estacionamentoId")
    data = dados.get("data")
    chegada = dados.get("chegada")
    saida = dados.get("saida")

    # Validar campos obrigatórios
    if not all([estacionamento_id, data, chegada, saida]):
        return jsonify({
            "erro": "Preencha todos os campos da reserva."
        }), 400

    # Validar data
    try:
        datetime.strptime(data, "%Y-%m-%d")
    except ValueError:
        return jsonify({
            "erro": "Data inválida."
        }), 400

    # Validar horários
    formato_hora = "%H:%M"

    try:
        inicio = datetime.strptime(chegada, formato_hora)
        fim = datetime.strptime(saida, formato_hora)
    except ValueError:
        return jsonify({
            "erro": "Horários inválidos."
        }), 400

    if fim <= inicio:
        return jsonify({
            "erro": "A saída deve ser posterior à chegada."
        }), 400

    # Referências do Firebase
    estacionamento_ref = db.collection(
        "estacionamentos"
    ).document(estacionamento_id)

    reserva_ref = db.collection("reservas").document()

    transaction = db.transaction()

    @firestore.transactional
    def salvar_reserva(transaction):

        # Consultar estacionamento
        estacionamento_doc = estacionamento_ref.get(
            transaction=transaction
        )

        if not estacionamento_doc.exists:
            raise ValueError("Estacionamento não encontrado.")

        estacionamento = estacionamento_doc.to_dict()

        vagas = int(estacionamento.get("vagasDisponiveis", 0))
        preco_hora = float(estacionamento.get("precoHora", 0))

        if vagas <= 0:
            raise ValueError("Não existem vagas disponíveis.")

        # Consultar reservas do mesmo estacionamento e dia
        consulta = (
            db.collection("reservas")
            .where("estacionamentoId", "==", estacionamento_id)
            .where("data", "==", data)
        )

        reservas_existentes = transaction.get(consulta)

        # Verificar conflito de horários
        for documento in reservas_existentes:

            reserva_existente = documento.to_dict()

            inicio_existente = reserva_existente.get("chegada")
            fim_existente = reserva_existente.get("saida")

            if (
                inicio_existente
                and fim_existente
                and chegada < fim_existente
                and saida > inicio_existente
            ):
                raise ValueError(
                    "Já existe uma reserva neste horário."
                )

        # Calcular valor no backend
        minutos = (fim - inicio).total_seconds() / 60
        horas = minutos / 60
        valor = round(horas * preco_hora, 2)

        # Criar reserva
        transaction.set(reserva_ref, {
            "estacionamentoId": estacionamento_id,
            "estacionamento": estacionamento.get("nome", ""),
            "data": data,
            "chegada": chegada,
            "saida": saida,
            "inicio": f"{data}T{chegada}:00",
            "fim": f"{data}T{saida}:00",
            "valor": valor,
            "status": "Pendente de pagamento"
        })

        # Atualizar vagas disponíveis
        transaction.update(estacionamento_ref, {
            "vagasDisponiveis": vagas - 1
        })

        return {
            "id": reserva_ref.id,
            "valor": valor,
            "vagasDisponiveis": vagas - 1,
            "estacionamento": estacionamento.get("nome", "")
        }

    try:

        resultado = salvar_reserva(transaction)

        return jsonify({
            "mensagem": "Reserva criada com sucesso!",
            "reserva": resultado
        }), 201

    except ValueError as erro:

        return jsonify({
            "erro": str(erro)
        }), 400

    except Exception as erro:

        app.logger.exception("Erro ao criar reserva")

        return jsonify({
            "erro": "Não foi possível criar a reserva."
        }), 500

    
# ==========================================
# AUTENTICAÇÃO DO ESP32
# ==========================================

def validar_dispositivo():
    segredo_servidor = os.getenv("DEVICE_SECRET")
    segredo_recebido = request.headers.get("X-Device-Secret", "")

    if not segredo_servidor:
        return False

    return hmac.compare_digest(segredo_servidor, segredo_recebido)


# ==========================================
# SOLICITAÇÃO DE ENTRADA E SAÍDA
# ==========================================

@app.route("/api/iot/access-request", methods=["POST"])
def solicitar_acesso():

    if not validar_dispositivo():
        return jsonify({
            "authorized": False,
            "reason": "Dispositivo não autenticado."
        }), 401

    dados = request.get_json(silent=True) or {}

    device_id = dados.get("device_id")
    estacionamento_id = dados.get("parking_lot_id")
    reserva_id = dados.get("reservation_id")
    tipo = dados.get("type")

    if not all([device_id, estacionamento_id, reserva_id, tipo]):
        return jsonify({
            "authorized": False,
            "reason": "Dados incompletos."
        }), 400

    if tipo not in ["ENTRY", "EXIT"]:
        return jsonify({
            "authorized": False,
            "reason": "Tipo de acesso inválido."
        }), 400

    if request.headers.get("X-Device-Id") != device_id:
        return jsonify({
            "authorized": False,
            "reason": "Identificação do dispositivo inválida."
        }), 401

    try:
        reserva_ref = db.collection("reservas").document(reserva_id)
        reserva_doc = reserva_ref.get()

        if not reserva_doc.exists:
            return jsonify({
                "authorized": False,
                "reason": "Reserva não encontrada."
            }), 404

        reserva = reserva_doc.to_dict()

        if reserva.get("estacionamentoId") != estacionamento_id:
            return jsonify({
                "authorized": False,
                "reason": "Reserva pertence a outro estacionamento."
            }), 403

        agora = datetime.now(ZoneInfo("America/Sao_Paulo"))

        # SAÍDA: não bloquear a saída de um veículo
        # que já teve a entrada registrada.
        
        if tipo == "EXIT":

            estacionamento_ref = db.collection(
                "estacionamentos"
            ).document(estacionamento_id)

            transaction = db.transaction()

            @firestore.transactional
            def registrar_saida(transaction):

                # Ler os documentos dentro da transação
                reserva_atual_doc = reserva_ref.get(
                    transaction=transaction
                )

                estacionamento_doc = estacionamento_ref.get(
                    transaction=transaction
                )

                if not reserva_atual_doc.exists:
                    return {
                        "erro": "Reserva não encontrada.",
                        "codigo": 404
                    }

                if not estacionamento_doc.exists:
                    return {
                        "erro": "Estacionamento não encontrado.",
                        "codigo": 404
                    }

                reserva_atual = reserva_atual_doc.to_dict()

                if not reserva_atual.get("entradaRegistrada"):
                    return {
                        "erro": "Entrada não registrada para esta reserva.",
                        "codigo": 403
                    }

                if reserva_atual.get("saidaRegistrada"):
                    return {
                        "erro": "Saída já registrada.",
                        "codigo": 409
                    }

                estacionamento = estacionamento_doc.to_dict()

                vagas = int(
                    estacionamento.get("vagasDisponiveis", 0)
                )

                total = int(
                    estacionamento.get("vagasTotais", vagas)
                )

                novas_vagas = min(vagas + 1, total)

                # Registrar a saída
                transaction.update(reserva_ref, {
                    "saidaRegistrada": True,
                    "saidaEm": agora
                })

                # Devolver a vaga
                transaction.update(estacionamento_ref, {
                    "vagasDisponiveis": novas_vagas
                })

                return {
                    "vagasDisponiveis": novas_vagas
                }

            resultado = registrar_saida(transaction)

            if "erro" in resultado:
                return jsonify({
                    "authorized": False,
                    "reason": resultado["erro"]
                }), resultado["codigo"]

            return jsonify({
                "authorized": True,
                "reason": "Saída autorizada.",
                "vagasDisponiveis": resultado["vagasDisponiveis"]
            }), 200

        # ENTRADA: exige pagamento aprovado.
        if reserva.get("statusPagamento") != "approved":
            return jsonify({
                "authorized": False,
                "reason": "Pagamento ainda não aprovado."
            }), 403

        if reserva.get("entradaRegistrada"):
            return jsonify({
                "authorized": False,
                "reason": "Entrada já registrada."
            }), 409

        # Conferir data e horário da reserva.
        data = reserva.get("data")
        chegada = reserva.get("chegada")
        saida = reserva.get("saida")

        try:
            inicio = datetime.strptime(
                f"{data} {chegada}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=ZoneInfo("America/Sao_Paulo"))

            fim = datetime.strptime(
                f"{data} {saida}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=ZoneInfo("America/Sao_Paulo"))

        except (ValueError, TypeError):
            return jsonify({
                "authorized": False,
                "reason": "Data ou horário da reserva inválido."
            }), 400

        if agora < inicio or agora > fim:
            return jsonify({
                "authorized": False,
                "reason": "Fora do horário reservado."
            }), 403

        reserva_ref.update({
            "entradaRegistrada": True,
            "entradaEm": agora
        })

        return jsonify({
            "authorized": True,
            "reason": "Entrada autorizada."
        }), 200

    except Exception:
        app.logger.exception("Erro ao validar acesso")

        return jsonify({
            "authorized": False,
            "reason": "Erro interno ao validar acesso."
        }), 500


# ==========================================
# RECEBER TELEMETRIA DO ESP32
# ==========================================

@app.route("/api/iot/telemetry", methods=["POST"])
def receber_telemetria():

    if not validar_dispositivo():
        return jsonify({
            "erro": "Dispositivo não autenticado."
        }), 401

    dados = request.get_json(silent=True) or {}

    device_id = dados.get("device_id")

    if not device_id:
        return jsonify({
            "erro": "Identificação do dispositivo não informada."
        }), 400

    if request.headers.get("X-Device-Id") != device_id:
        return jsonify({
            "erro": "Identificação do dispositivo inválida."
        }), 401

    dados["atualizadoEm"] = datetime.now(
        ZoneInfo("America/Sao_Paulo")
    )

    db.collection("dispositivos").document(device_id).set(
        dados,
        merge=True
    )

    return jsonify({
        "mensagem": "Telemetria recebida com sucesso!"
    }), 200


if __name__ == "__main__":
    app.run(debug=True, port=5000)