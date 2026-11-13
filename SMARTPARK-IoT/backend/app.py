import os
import firebase_admin
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


if __name__ == "__main__":
    app.run(debug=True, port=5000)